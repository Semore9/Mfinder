package gogoscan

import (
	"context"
	"math"
	"sync"
	"sync/atomic"
	"time"

	"github.com/panjf2000/ants/v2"
	"mfinder/backend/utils"
)

// TokenBucket provides a simple thread-safe token bucket implementation.
type TokenBucket struct {
	rate float64
	cap  float64

	mu   sync.Mutex
	tok  float64
	last time.Time
}

func NewTokenBucket(rate float64, capacity int) *TokenBucket {
	if rate <= 0 {
		return nil
	}
	if capacity <= 0 {
		capacity = int(rate)
		if capacity <= 0 {
			capacity = 1
		}
	}
	return &TokenBucket{rate: rate, cap: float64(capacity), tok: 0, last: time.Now()}
}

func (b *TokenBucket) Wait(n int) time.Duration {
	if b == nil {
		return 0
	}
	if n <= 0 {
		return 0
	}
	need := float64(n)

	b.mu.Lock()
	defer b.mu.Unlock()

	now := time.Now()
	elapsed := now.Sub(b.last).Seconds()
	if elapsed > 0 {
		b.tok = math.Min(b.cap, b.tok+b.rate*elapsed)
		b.last = now
	}
	if b.tok >= need {
		b.tok -= need
		return 0
	}
	deficit := need - b.tok
	wait := deficit / b.rate
	// keep last pegged to the observation time so the next caller can
	// accumulate freshly generated tokens based on real elapsed time.
	b.last = now
	return time.Duration(wait * float64(time.Second))
}

// rateLimiter coordinates global and per-target rate limiting.
type rateLimiter struct {
	global  *TokenBucket
	perIP   sync.Map // map[string]*TokenBucket
	perRate float64
	perCap  int
}

func newRateLimiterFromOptions(opts ConcurrencyOptions) *rateLimiter {
	rl := &rateLimiter{}
	if opts.MaxPPS > 0 {
		cap := opts.MaxPPS / 4
		if cap <= 0 {
			cap = opts.MaxPPS
		}
		rl.global = NewTokenBucket(float64(opts.MaxPPS), cap)
	}
	if opts.PerIPMaxPPS > 0 {
		rl.perRate = float64(opts.PerIPMaxPPS)
		cap := opts.PerIPMaxPPS / 4
		if cap <= 0 {
			cap = opts.PerIPMaxPPS
		}
		rl.perCap = cap
	}
	if rl.global == nil && rl.perRate <= 0 {
		return nil
	}
	return rl
}

func (r *rateLimiter) reserveBatch(ip string, batch int) (bool, time.Duration) {
	if r == nil || batch <= 0 {
		return true, 0
	}

	var waits []time.Duration

	if r.global != nil {
		if wait := r.global.Wait(batch); wait > 0 {
			waits = append(waits, wait)
		}
	}

	if r.perRate > 0 && ip != "" {
		bucketAny, _ := r.perIP.LoadOrStore(ip, NewTokenBucket(r.perRate, r.perCap))
		bucket := bucketAny.(*TokenBucket)
		if wait := bucket.Wait(batch); wait > 0 {
			waits = append(waits, wait)
		}
	}

	if len(waits) == 0 {
		return true, 0
	}

	maxWait := waits[0]
	for _, w := range waits[1:] {
		if w > maxWait {
			maxWait = w
		}
	}
	return false, maxWait
}

// executionStats gathers rolling metrics for the auto scaler.
type executionStats struct {
	successes   atomic.Uint64
	failures    atomic.Uint64
	timeouts    atomic.Uint64
	durationsNS atomic.Uint64
	inflight    atomic.Int64
	backlog     atomic.Int64
}

func (s *executionStats) recordStart() {
	s.inflight.Add(1)
}

func (s *executionStats) recordFinish(success bool, timeout bool, duration time.Duration) {
	if success {
		s.successes.Add(1)
	} else if timeout {
		s.timeouts.Add(1)
	} else {
		s.failures.Add(1)
	}
	if dur := duration.Nanoseconds(); dur > 0 {
		s.durationsNS.Add(uint64(dur))
	}
	s.inflight.Add(-1)
}

func (s *executionStats) snapshot(prev statsSnapshot) statsSnapshot {
	snap := statsSnapshot{
		successes:   s.successes.Load(),
		failures:    s.failures.Load(),
		timeouts:    s.timeouts.Load(),
		durationsNS: s.durationsNS.Load(),
		inflight:    s.inflight.Load(),
		backlog:     s.backlog.Load(),
	}
	snap.deltaSuccess = snap.successes - prev.successes
	snap.deltaFailure = snap.failures - prev.failures
	snap.deltaTimeout = snap.timeouts - prev.timeouts
	snap.deltaDurNS = snap.durationsNS - prev.durationsNS
	return snap
}

type statsSnapshot struct {
	successes   uint64
	failures    uint64
	timeouts    uint64
	durationsNS uint64
	inflight    int64
	backlog     int64

	deltaSuccess uint64
	deltaFailure uint64
	deltaTimeout uint64
	deltaDurNS   uint64
}

// concurrencyManager owns runtime concurrency tuning and rate limiting.
type concurrencyManager struct {
	mode            ConcurrencyMode
	options         ConcurrencyOptions
	limiter         *rateLimiter
	stats           *executionStats
	pool            *ants.PoolWithFunc
	maxThreads      int
	minThreads      int
	inflightLimit   int
	inflight        chan struct{}
	permitsGranted  atomic.Uint64
	permitMu        sync.Mutex
	lastPermits     uint64
	lastPermitsTime time.Time
	cachedPPS       float64
	runStart        time.Time

	ctx    context.Context
	cancel context.CancelFunc

	last statsSnapshot
}

func newConcurrencyManager(ctx context.Context, opts ConcurrencyOptions, params ScanParams) *concurrencyManager {
	cctx, cancel := context.WithCancel(ctx)
	mgr := &concurrencyManager{
		mode:     normalizeConcurrencyMode(opts.Mode),
		options:  opts,
		limiter:  newRateLimiterFromOptions(opts),
		stats:    &executionStats{},
		ctx:      cctx,
		cancel:   cancel,
		runStart: time.Now(),
	}

	if mgr.mode == "" {
		mgr.mode = ConcurrencyModeAuto
	}

	baseline := defaultThreadCount()
	if baseline < 8 {
		baseline = 8
	}
	if fdCap := fdAwareThreadCap(); fdCap > 0 && baseline > fdCap {
		baseline = fdCap
	}
	mgr.minThreads = 8

	if mgr.mode == ConcurrencyModeManual {
		threads := opts.Threads
		if threads <= 0 {
			threads = baseline
		}
		mgr.maxThreads = threads
		mgr.options.Threads = threads
	} else {
		maxThreads := opts.MaxThreads
		if maxThreads <= 0 {
			maxThreads = defaultAutoMaxThreads()
		}
		if fdCap := fdAwareThreadCap(); fdCap > 0 && maxThreads > fdCap {
			maxThreads = fdCap
		}
		mgr.maxThreads = maxThreads
	}

	mgr.configureInflightLimit(params)

	return mgr
}

func (m *concurrencyManager) Close() {
	m.cancel()
}

func (m *concurrencyManager) InitialWorkers() int {
	if m.mode == ConcurrencyModeManual {
		if m.options.Threads <= 0 {
			m.options.Threads = defaultThreadCount()
		}
		if m.options.Threads < m.minThreads {
			return m.minThreads
		}
		return m.options.Threads
	}
	base := defaultThreadCount()
	if base < m.minThreads {
		base = m.minThreads
	}
	if base > m.maxThreads {
		base = m.maxThreads
	}
	return base
}

func (m *concurrencyManager) BindPool(pool *ants.PoolWithFunc) {
	m.pool = pool
	if m.mode == ConcurrencyModeAuto {
		go m.autoTuneLoop()
	}
}

func (m *concurrencyManager) WaitRate(ip string) {
	// left for compatibility if needed
}

func (m *concurrencyManager) reserveTokens(ip string, batch int) (bool, time.Duration) {
	if m == nil || batch <= 0 {
		return true, 0
	}
	if m.limiter == nil {
		m.recordPermits(batch)
		return true, 0
	}
	ok, wait := m.limiter.reserveBatch(ip, batch)
	if ok {
		m.recordPermits(batch)
	}
	return ok, wait
}

func (m *concurrencyManager) WaitBatch(ip string, batch int) (bool, time.Duration) {
	return m.reserveTokens(ip, batch)
}

func (m *concurrencyManager) recordPermits(n int) {
	if n <= 0 {
		return
	}
	m.permitsGranted.Add(uint64(n))
}

func (m *concurrencyManager) EffectivePPS() float64 {
	if m == nil {
		return 0
	}
	now := time.Now()
	total := m.permitsGranted.Load()
	m.permitMu.Lock()
	defer m.permitMu.Unlock()
	if m.lastPermitsTime.IsZero() {
		m.lastPermitsTime = now
		m.lastPermits = total
		return 0
	}
	elapsed := now.Sub(m.lastPermitsTime)
	if elapsed <= 0 {
		return m.cachedPPS
	}
	if elapsed < time.Second {
		return m.cachedPPS
	}
	delta := total - m.lastPermits
	m.lastPermits = total
	m.lastPermitsTime = now
	pps := 0.0
	if elapsed > 0 {
		pps = float64(delta) / elapsed.Seconds()
	}
	const alpha = 0.3
	if m.cachedPPS == 0 {
		m.cachedPPS = pps
	} else {
		m.cachedPPS = alpha*pps + (1-alpha)*m.cachedPPS
	}
	return m.cachedPPS
}

func (m *concurrencyManager) Uptime() time.Duration {
	return time.Since(m.runStart)
}

func (m *concurrencyManager) IncBacklog(n int) {
	if n <= 0 {
		return
	}
	m.stats.backlog.Add(int64(n))
}

func (m *concurrencyManager) DecBacklog(n int) {
	if n <= 0 {
		return
	}
	if newVal := m.stats.backlog.Add(-int64(n)); newVal < 0 {
		m.stats.backlog.Store(0)
	}
}

func (m *concurrencyManager) BacklogSize() int {
	return int(m.stats.backlog.Load())
}

func (m *concurrencyManager) RecordStart() {
	m.stats.recordStart()
}

func (m *concurrencyManager) RecordFinish(success bool, timeout bool, duration time.Duration) {
	m.stats.recordFinish(success, timeout, duration)
}

func (m *concurrencyManager) acquireInflight(ctx context.Context) bool {
	if m.inflight == nil {
		return true
	}
	select {
	case m.inflight <- struct{}{}:
		return true
	case <-ctx.Done():
		return false
	}
}

func (m *concurrencyManager) releaseInflight() {
	if m.inflight == nil {
		return
	}
	select {
	case <-m.inflight:
	default:
	}
}

func (m *concurrencyManager) autoTuneLoop() {
	ticker := time.NewTicker(2 * time.Second)
	defer ticker.Stop()

	if m.pool == nil {
		return
	}

	currentThreads := m.pool.Cap()
	if currentThreads <= 0 {
		currentThreads = m.InitialWorkers()
	}
	m.last = m.stats.snapshot(statsSnapshot{})

	for {
		select {
		case <-m.ctx.Done():
			return
		case <-ticker.C:
			snap := m.stats.snapshot(m.last)
			m.last = snap

			windowOps := snap.deltaSuccess + snap.deltaFailure + snap.deltaTimeout
			errRate := float64(0)
			timeoutRate := float64(0)
			if windowOps > 0 {
				errRate = float64(snap.deltaFailure) / float64(windowOps)
				timeoutRate = float64(snap.deltaTimeout) / float64(windowOps)
			}

			avgRTT := 0.0
			if snap.deltaDurNS > 0 && windowOps > 0 {
				avgRTT = float64(snap.deltaDurNS) / float64(windowOps) / float64(time.Millisecond)
			}

			cpuUsage := m.sampleCPU()

			desired := currentThreads
			switch {
			case cpuUsage > 85 || errRate > 0.05 || timeoutRate > 0.03:
				desired = int(float64(currentThreads) * 0.7)
			case snap.backlog > int64(currentThreads):
				desired = currentThreads + 64
			case avgRTT < 50 && snap.backlog > 0:
				desired = currentThreads + 32
			}

			if desired < m.minThreads {
				desired = m.minThreads
			}
			if desired > m.maxThreads {
				desired = m.maxThreads
			}

			if desired != currentThreads {
				m.pool.Tune(desired)
				currentThreads = desired
			}
		}
	}
}

func (m *concurrencyManager) sampleCPU() float64 {
	stats, err := utils.GetSystemStats()
	if err != nil {
		return 0
	}
	return stats.ProcessCPUUsage * 100
}

func (m *concurrencyManager) configureInflightLimit(params ScanParams) {
	limit := m.estimateInflightLimit(params)
	if limit <= 0 {
		limit = m.maxThreads * portChunkSize
	}
	minLimit := m.minThreads * portChunkSize
	if limit < minLimit {
		limit = minLimit
	}
	m.inflightLimit = limit
	if limit > 0 {
		m.inflight = make(chan struct{}, limit)
	}
}

func (m *concurrencyManager) estimateInflightLimit(params ScanParams) int {
	globalRate := m.options.MaxPPS
	if globalRate <= 0 {
		if m.mode == ConcurrencyModeManual && m.options.Threads > 0 {
			globalRate = m.options.Threads * 20
		} else {
			globalRate = defaultGlobalMaxPPS
		}
	}
	timeoutSeconds := float64(params.Delay + params.HTTPSDelay)
	if timeoutSeconds <= 0 {
		timeoutSeconds = 2
	}

	chunk := portChunkSize
	if chunk <= 0 {
		chunk = 1
	}

	var candidates []int
	if globalRate > 0 {
		rateCap := int(float64(globalRate) * timeoutSeconds)
		if rateCap <= 0 {
			rateCap = globalRate
		}
		candidates = append(candidates, rateCap)
	}

	threadCap := m.maxThreads * portChunkSize * 4
	if threadCap > 0 {
		candidates = append(candidates, threadCap)
	}

	if fd := fdSoftLimit(); fd > 0 {
		fdCap := fd / 2
		if fdCap > 0 {
			candidates = append(candidates, fdCap)
		}
	}

	limit := 0
	if len(candidates) > 0 {
		limit = candidates[0]
		for _, c := range candidates[1:] {
			if c > 0 && c < limit {
				limit = c
			}
		}
	}
	if limit < chunk {
		limit = chunk
	}
	return limit
}
