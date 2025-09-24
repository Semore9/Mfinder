package gogoscan

import (
	"context"
	"errors"
	"fmt"
	"net"
	"net/netip"
	"os"
	"path/filepath"
	"runtime"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/chainreactors/fingers/favicon"
	"github.com/chainreactors/fingers/fingers"
	gogocore "github.com/chainreactors/gogo/v2/core"
	gogoe "github.com/chainreactors/gogo/v2/engine"
	gogopkg "github.com/chainreactors/gogo/v2/pkg"
	"github.com/chainreactors/parsers"
	"github.com/chainreactors/utils"
	"github.com/panjf2000/ants/v2"
	"go4.org/netipx"
	"sigs.k8s.io/yaml"
)

const defaultModeValue = "default"
const (
	portChunkSize             = 8
	dispatchQueuePerWorker    = 4
	defaultPreflightPortsSpec = "80,443,53,3389"
)

const (
	defaultResolveTimeout   = 5 * time.Second
	defaultPreflightTimeout = 500 * time.Millisecond
	defaultGlobalMaxPPS     = 200
	defaultPerIPMaxPPS      = 20
)

// Engine a light-weight orchestrator around gogo's scanning primitives.
type Engine struct {
	once     sync.Once
	initErr  error
	defaults DefaultOptions
	mu       sync.RWMutex
	runMu    sync.Mutex
}

// NewEngine creates a new Engine using the provided defaults (falling back to sensible values when omitted).
func NewEngine(defaults DefaultOptions) *Engine {
	normalized := normalizeDefaults(defaults)
	return &Engine{defaults: normalized}
}

// UpdateDefaults atomically replaces the engine default options.
func (e *Engine) UpdateDefaults(next DefaultOptions) {
	e.mu.Lock()
	e.defaults = normalizeDefaults(next)
	e.mu.Unlock()
}

// Defaults returns a snapshot of the current default options.
func (e *Engine) Defaults() DefaultOptions {
	e.mu.RLock()
	defer e.mu.RUnlock()
	return e.defaults
}

// Run kicks off a scan with the supplied parameters, returning two channels: one streaming
// successful results, the other delivering terminal or operational errors.
func (e *Engine) Run(ctx context.Context, params ScanParams) (<-chan Result, <-chan Progress, <-chan error, error) {
	e.runMu.Lock()
	defer e.runMu.Unlock()

	snapshot := e.Defaults()
	params = params.WithDefaults(snapshot)

	targets := params.NormalizedTargets()
	if len(targets) == 0 {
		return nil, nil, nil, errors.New("no targets specified")
	}

	if err := e.ensureInit(); err != nil {
		return nil, nil, nil, err
	}

	if err := validateMode(params.Mode); err != nil {
		return nil, nil, nil, err
	}

	buildOpts := cidrBuildOptions{
		resolveHosts:  params.ResolveHosts,
		resolveIPv6:   params.ResolveIPv6,
		allowLoopback: params.AllowLoopback,
		allowPrivate:  params.AllowPrivate,
	}
	cidrs, hostMap, err := buildCIDRs(targets, params.Exclude, buildOpts)
	if err != nil {
		return nil, nil, nil, err
	}

	ports, err := parsePorts(params.Ports)
	if err != nil {
		return nil, nil, nil, err
	}

	var preflight *preflightConfig
	if params.PreflightEnabled {
		pfPorts, err := parsePreflightPorts(params.PreflightPorts)
		if err != nil {
			return nil, nil, nil, err
		}
		timeout := time.Duration(params.PreflightTimeout) * time.Millisecond
		if timeout <= 0 {
			timeout = defaultPreflightTimeout
		}
		preflight = &preflightConfig{ports: pfPorts, timeout: timeout}
		if len(preflight.ports) == 0 {
			preflight = nil
		}
	}

	configureEngineGlobals(params)
	workerLabel := params.Worker

	concurrencyMgr := newConcurrencyManager(ctx, params.Concurrency, params)
	defer concurrencyMgr.Close()

	initialWorkers := concurrencyMgr.InitialWorkers()

	results := make(chan Result, 64)
	progress := make(chan Progress, 32)
	errs := make(chan error, 1)

	go func() {
		defer close(results)
		defer close(progress)
		defer close(errs)

		var planned int
		for _, cidr := range cidrs {
			planned += cidr.Count()
		}
		planned = planned * len(ports)
		if planned <= 0 {
			planned = len(ports)
		}

		reporter := newProgressReporter(ctx, progress, planned, concurrencyMgr)
		defer reporter.Close()

		var wg sync.WaitGroup
		pool, err := ants.NewPoolWithFunc(initialWorkers, func(item interface{}) {
			tgt := item.(scanTarget)
			defer wg.Done()
			if concurrencyMgr != nil {
				defer concurrencyMgr.releaseInflight()
			}

			reporter.Started(1)
			if concurrencyMgr != nil {
				concurrencyMgr.RecordStart()
			}
			begin := time.Now()

			res := gogopkg.NewResult(tgt.ip, tgt.port)
			if len(tgt.hosts) == 1 {
				res.CurrentHost = tgt.hosts[0]
			}
			if len(tgt.hosts) > 0 {
				res.HttpHosts = append([]string(nil), tgt.hosts...)
			}

			gogoe.Dispatch(res)
			duration := time.Since(begin)
			if res.Open {
				reporter.Succeeded(1)
				converted := convertResult(res, tgt.hosts, workerLabel)
				select {
				case results <- converted:
				case <-ctx.Done():
				}
			} else {
				if classifyStatus(res.Status) {
					reporter.TimedOut(1)
				} else {
					reporter.Failed(1)
				}
			}
			timeout := classifyStatus(res.Status)
			concurrencyMgr.RecordFinish(res.Open, timeout, duration)
		})
		if err != nil {
			errs <- err
			return
		}
		defer pool.Release()
		concurrencyMgr.BindPool(pool)

		loopErr := dispatchTargets(ctx, &wg, pool, reporter, cidrs, hostMap, ports, concurrencyMgr, preflight)
		wg.Wait()

		if loopErr != nil && !errors.Is(loopErr, context.Canceled) {
			errs <- loopErr
			return
		}
		if ctx.Err() != nil {
			errs <- ctx.Err()
		}
	}()

	return results, progress, errs, nil
}

// EstimateWorkload returns the number of individual IP addresses and ports that would be
// processed for the provided parameters after defaults are applied.
func (e *Engine) EstimateWorkload(params ScanParams) (int, int, error) {
	snapshot := e.Defaults()
	params = params.WithDefaults(snapshot)

	targets := params.NormalizedTargets()
	if len(targets) == 0 {
		return 0, 0, errors.New("no targets specified")
	}

	if err := validateMode(params.Mode); err != nil {
		return 0, 0, err
	}

	buildOpts := cidrBuildOptions{
		resolveHosts:  params.ResolveHosts,
		resolveIPv6:   params.ResolveIPv6,
		allowLoopback: params.AllowLoopback,
		allowPrivate:  params.AllowPrivate,
	}
	cidrs, _, err := buildCIDRs(targets, params.Exclude, buildOpts)
	if err != nil {
		return 0, 0, err
	}

	if err := e.ensureInit(); err != nil {
		return 0, 0, err
	}

	ports, err := parsePorts(params.Ports)
	if err != nil {
		return 0, 0, err
	}

	var ipTotal int
	for _, cidr := range cidrs {
		ipTotal += cidr.Count()
	}

	return ipTotal, len(ports), nil
}

func (e *Engine) ensureInit() error {
	e.once.Do(func() {
		templateRoot, err := locateTemplateRoot()
		if err != nil {
			e.initErr = fmt.Errorf("locate template root failed: %w", err)
			return
		}
		portPath := filepath.Join(templateRoot, "port.yaml")
		if err := gogopkg.LoadPortConfig(portPath); err != nil {
			e.initErr = fmt.Errorf("load port config failed: %w", err)
			return
		}

		fingerFiles := collectFingerFiles(templateRoot)
		if len(fingerFiles) > 0 {
			if err := gogopkg.LoadFinger(fingerFiles); err != nil {
				fmt.Printf("[gogo] warn: load finger config failed: %v\n", err)
			}
		}
		if gogopkg.FingerEngine == nil {
			if engine, err := fingers.NewFingersEngineWithCustom(nil, nil); err == nil {
				gogopkg.FingerEngine = engine
			}
		}
		if gogopkg.FingerEngine == nil {
			gogopkg.FingerEngine = &fingers.FingersEngine{
				HTTPFingers:              fingers.Fingers{},
				HTTPFingersActiveFingers: fingers.Fingers{},
				SocketFingers:            fingers.Fingers{},
				SocketGroup:              fingers.FingerMapper{},
				Favicons:                 favicon.NewFavicons(),
			}
		}

		if err := loadExtractorFromFile(filepath.Join(templateRoot, "extract.yaml")); err != nil {
			fmt.Printf("[gogo] warn: load extractor failed: %v\n", err)
		}
		gogopkg.LoadNeutron("")
	})
	return e.initErr
}

func normalizeDefaults(d DefaultOptions) DefaultOptions {
	out := d
	if strings.TrimSpace(out.Ports) == "" {
		out.Ports = "top1"
	}
	if strings.TrimSpace(out.Mode) == "" {
		out.Mode = defaultModeValue
	}
	if out.Delay <= 0 {
		out.Delay = 2
	}
	if out.HTTPSDelay < 0 {
		out.HTTPSDelay = 2
	}
	if strings.TrimSpace(out.Exploit) == "" {
		out.Exploit = "none"
	}
	if out.Verbose < 0 {
		out.Verbose = 0
	}
	if strings.TrimSpace(out.PortProbe) == "" {
		out.PortProbe = defaultModeValue
	}
	if strings.TrimSpace(out.IPProbe) == "" {
		out.IPProbe = defaultModeValue
	}
	if strings.TrimSpace(out.PreflightPorts) == "" {
		out.PreflightPorts = defaultPreflightPortsSpec
	}
	if out.PreflightTimeout <= 0 {
		out.PreflightTimeout = int(defaultPreflightTimeout / time.Millisecond)
	}
	out.Concurrency = normalizeDefaultConcurrency(out.Concurrency)
	return out
}

func normalizeDefaultConcurrency(opts ConcurrencyOptions) ConcurrencyOptions {
	mode := normalizeConcurrencyMode(opts.Mode)
	if mode == "" {
		mode = ConcurrencyModeAuto
	}
	opts.Mode = mode
	switch mode {
	case ConcurrencyModeManual:
		if opts.Threads <= 0 {
			opts.Threads = defaultThreadCount()
		}
		if opts.MaxPPS <= 0 {
			opts.MaxPPS = defaultGlobalMaxPPS
		}
		if opts.PerIPMaxPPS <= 0 {
			opts.PerIPMaxPPS = defaultPerIPMaxPPS
		}
		if opts.MaxPPS < 0 {
			opts.MaxPPS = 0
		}
		if opts.PerIPMaxPPS < 0 {
			opts.PerIPMaxPPS = 0
		}
		opts.MaxThreads = 0
	default:
		if opts.MaxThreads <= 0 {
			opts.MaxThreads = defaultAutoMaxThreads()
		}
		if opts.MaxPPS <= 0 {
			opts.MaxPPS = defaultGlobalMaxPPS
		}
		if opts.PerIPMaxPPS <= 0 {
			opts.PerIPMaxPPS = defaultPerIPMaxPPS
		}
		if opts.MaxPPS < 0 {
			opts.MaxPPS = 0
		}
		if opts.PerIPMaxPPS < 0 {
			opts.PerIPMaxPPS = 0
		}
		opts.Threads = 0
	}
	return opts
}

func defaultAutoMaxThreads() int {
	base := defaultThreadCount() * 2
	if base < 128 {
		base = 128
	}
	if base > 1024 {
		base = 1024
	}
	return base
}

func configureEngineGlobals(params ScanParams) {
	exclude := parseCIDRList(params.Exclude)
	gogoe.RunOpt = gogoe.RunnerOpts{
		Delay:        params.Delay,
		HttpsDelay:   params.HTTPSDelay,
		Exploit:      sanitizeExploit(params.Exploit),
		VersionLevel: sanitizeVerbose(params.Verbose),
		Debug:        params.Debug,
		Opsec:        params.Opsec,
		ExcludeCIDRs: exclude,
	}
	gogoe.RunOpt.Sum = 0
	gogoe.RunOpt.ScanFilters = nil

	gogopkg.ExecuterOptions.Options.Timeout = params.Delay + params.HTTPSDelay
	gogopkg.HttpTimeout = time.Duration(params.Delay+params.HTTPSDelay) * time.Second

	gogocore.Opt.NoScan = params.NoScan
	gogocore.Opt.PluginDebug = params.Debug
	gogocore.Opt.AliveSum = 0
}

type scanTarget struct {
	ip    string
	port  string
	hosts []string
}

type scheduledTarget struct {
	item    scanTarget
	readyAt time.Time
}

type cidrBuildOptions struct {
	resolveHosts  bool
	resolveIPv6   bool
	allowLoopback bool
	allowPrivate  bool
}

type preflightConfig struct {
	ports   []int
	timeout time.Duration
}

func dispatchTargets(ctx context.Context, wg *sync.WaitGroup, pool *ants.PoolWithFunc, reporter *progressReporter, cidrs utils.CIDRs, hostMap map[string][]string, ports []string, conc *concurrencyManager, preflight *preflightConfig) error {
	if len(cidrs) == 0 || len(ports) == 0 {
		return nil
	}

	maxThreads := defaultThreadCount()
	if conc != nil {
		maxThreads = conc.maxThreads
		if maxThreads <= 0 {
			maxThreads = conc.InitialWorkers()
		}
	}
	queueCap := maxThreads * dispatchQueuePerWorker
	if queueCap < portChunkSize {
		queueCap = portChunkSize
	}

	taskCh := make(chan scanTarget, queueCap)
	streamErrCh := make(chan error, 1)

	go func() {
		err := streamTargets(ctx, taskCh, reporter, cidrs, hostMap, ports, conc, preflight)
		close(taskCh)
		streamErrCh <- err
	}()

	var (
		pending []scanTarget
		delayed []scheduledTarget
		timer   *time.Timer
		timerC  <-chan time.Time
	)

	resetTimer := func(now time.Time) {
		if len(delayed) == 0 {
			if timer != nil {
				if !timer.Stop() {
					select {
					case <-timer.C:
					default:
					}
				}
				timer = nil
			}
			timerC = nil
			return
		}
		wait := delayed[0].readyAt.Sub(now)
		if wait < 0 {
			wait = 0
		}
		if timer == nil {
			timer = time.NewTimer(wait)
		} else {
			if !timer.Stop() {
				select {
				case <-timer.C:
				default:
				}
			}
			timer.Reset(wait)
		}
		timerC = timer.C
	}

	pushDelayed := func(entry scheduledTarget) {
		delayed = append(delayed, entry)
		sort.Slice(delayed, func(i, j int) bool {
			return delayed[i].readyAt.Before(delayed[j].readyAt)
		})
	}

	popDelayedReady := func(now time.Time) {
		for len(delayed) > 0 && !delayed[0].readyAt.After(now) {
			pending = append(pending, delayed[0].item)
			delayed = delayed[1:]
		}
	}

	taskChOpen := true
	canceled := false

	for {
		now := time.Now()
		popDelayedReady(now)
		if len(delayed) > 0 {
			resetTimer(now)
		} else if timerC != nil {
			if timer != nil {
				if !timer.Stop() {
					select {
					case <-timer.C:
					default:
					}
				}
				timer = nil
			}
			timerC = nil
		}

		if len(pending) > 0 {
			tgt := pending[0]
			pending = pending[1:]
			if conc != nil {
				conc.DecBacklog(1)
				if !conc.acquireInflight(ctx) {
					if ctx.Err() != nil {
						return ctx.Err()
					}
					// failed to acquire due to cancel; treat as reschedule
					conc.IncBacklog(1)
					pushDelayed(scheduledTarget{item: tgt, readyAt: now.Add(50 * time.Millisecond)})
					resetTimer(now)
					continue
				}
				granted, wait := conc.WaitBatch(tgt.ip, 1)
				if !granted {
					conc.releaseInflight()
					conc.IncBacklog(1)
					var readyAt time.Time
					if wait <= 0 {
						readyAt = now.Add(50 * time.Millisecond)
					} else {
						readyAt = now.Add(wait)
					}
					pushDelayed(scheduledTarget{item: tgt, readyAt: readyAt})
					resetTimer(now)
					continue
				}
			}
			wg.Add(1)
			if err := pool.Invoke(tgt); err != nil {
				wg.Done()
				if conc != nil {
					conc.releaseInflight()
				}
				return err
			}
			continue
		}

		if !taskChOpen {
			if len(delayed) == 0 {
				err := <-streamErrCh
				if canceled && err == nil {
					return ctx.Err()
				}
				return err
			}
		}

		select {
		case tgt, ok := <-taskCh:
			if !ok {
				taskChOpen = false
				continue
			}
			pending = append(pending, tgt)
		case <-timerC:
			// timer fired, loop will promote delayed targets
		case <-ctx.Done():
			canceled = true
			if !taskChOpen && len(pending) == 0 && len(delayed) == 0 {
				err := <-streamErrCh
				if err != nil {
					return err
				}
				return ctx.Err()
			}
		}
	}
}

func streamTargets(ctx context.Context, out chan scanTarget, reporter *progressReporter, cidrs utils.CIDRs, hostMap map[string][]string, ports []string, conc *concurrencyManager, preflight *preflightConfig) error {
	iterators := buildIterators(cidrs)
	if len(iterators) == 0 {
		return nil
	}

	queue := make([]*ipCursor, 0, len(iterators))
	for _, it := range iterators {
		if !it.advance(hostMap) {
			continue
		}
		queue = append(queue, it)
	}

	if len(queue) == 0 {
		return nil
	}

	for len(queue) > 0 {
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
		}

		cursor := queue[0]
		queue = queue[1:]

		if preflight != nil {
			if !cursor.preflightChecked {
				allowed, err := runPreflight(ctx, cursor.ip, preflight)
				if err != nil {
					return err
				}
				cursor.preflightChecked = true
				cursor.preflightAllowed = allowed
			}
			if !cursor.preflightAllowed {
				if len(ports) > 0 {
					reporter.Started(len(ports))
					reporter.Failed(len(ports))
				}
				if !cursor.advance(hostMap) {
					continue
				}
				queue = append(queue, cursor)
				continue
			}
		}

		start := cursor.portIndex
		end := start + portChunkSize
		if end > len(ports) {
			end = len(ports)
		}
		chunk := ports[start:end]

		reporter.Enqueued(len(chunk))
		if conc != nil {
			conc.IncBacklog(len(chunk))
		}

		for i, port := range chunk {
			select {
			case <-ctx.Done():
				if conc != nil {
					remaining := len(chunk) - i
					if remaining > 0 {
						conc.DecBacklog(remaining)
					}
				}
				return ctx.Err()
			case out <- scanTarget{ip: cursor.ip, port: port, hosts: cursor.hosts}:
			}
		}

		if end >= len(ports) {
			if !cursor.advance(hostMap) {
				continue
			}
		} else {
			cursor.portIndex = end
		}

		queue = append(queue, cursor)
	}

	return nil
}

type cidrCursor struct {
	cidr      *utils.CIDR
	remaining int
	fallback  string
}

func newCIDRCursor(cidr *utils.CIDR) *cidrCursor {
	if cidr == nil {
		return nil
	}
	cidr.Reset()
	return &cidrCursor{
		cidr:      cidr,
		remaining: cidr.Count(),
		fallback:  cidr.IP.String(),
	}
}

func (c *cidrCursor) nextIP() (string, bool) {
	if c == nil || c.remaining <= 0 {
		return "", false
	}
	ip := c.cidr.Next()
	if ip == nil {
		c.remaining = 0
		return "", false
	}
	c.remaining--
	return ip.String(), true
}

type ipCursor struct {
	cursor           *cidrCursor
	ip               string
	hosts            []string
	portIndex        int
	preflightChecked bool
	preflightAllowed bool
	readyAt          time.Time
}

func (c *ipCursor) advance(hostMap map[string][]string) bool {
	ip, ok := c.cursor.nextIP()
	if !ok {
		return false
	}
	c.ip = ip
	c.hosts = hostsForIP(ip, hostMap, c.cursor.fallback)
	c.portIndex = 0
	c.preflightChecked = false
	c.preflightAllowed = false
	c.readyAt = time.Time{}
	return true
}

func buildIterators(cidrs utils.CIDRs) []*ipCursor {
	iterators := make([]*ipCursor, 0, len(cidrs))
	for _, cidr := range cidrs {
		cursor := newCIDRCursor(cidr)
		if cursor == nil || cursor.remaining <= 0 {
			continue
		}
		iterators = append(iterators, &ipCursor{cursor: cursor})
	}
	return iterators
}

func hostsForIP(ip string, hostMap map[string][]string, fallback string) []string {
	if hosts, ok := hostMap[ip]; ok && len(hosts) > 0 {
		return append([]string(nil), hosts...)
	}
	if hosts, ok := hostMap[fallback]; ok && len(hosts) > 0 {
		return append([]string(nil), hosts...)
	}
	return nil
}

func buildCIDRs(targets []string, excludes []string, opts cidrBuildOptions) (utils.CIDRs, map[string][]string, error) {
	builder := netipx.IPSetBuilder{}
	hostMap := make(map[string][]string)
	var includeCount int

	appendHost := func(ip string, host string) {
		if host == "" {
			return
		}
		hostMap[ip] = appendUnique(hostMap[ip], host)
	}

	for _, raw := range targets {
		raw = strings.TrimSpace(raw)
		if raw == "" {
			continue
		}
		cidr := utils.ParseCIDR(raw)
		if cidr == nil {
			return nil, nil, fmt.Errorf("invalid target: %s", raw)
		}

		host := strings.TrimSpace(cidr.IP.Host)
		if host != "" && !utils.IsIp(host) && opts.resolveHosts {
			records, err := resolveHostRecords(host, opts.resolveIPv6)
			if err != nil {
				return nil, nil, fmt.Errorf("resolve %s failed: %w", host, err)
			}
			allowed := make([]netip.Addr, 0, len(records))
			for _, addr := range records {
				if !addrAllowed(addr, opts) {
					continue
				}
				allowed = append(allowed, addr)
				appendHost(addr.String(), host)
			}
			if len(allowed) == 0 {
				return nil, nil, fmt.Errorf("host %s resolved but all addresses are disallowed", host)
			}
			for _, addr := range allowed {
				builder.AddPrefix(netip.PrefixFrom(addr, addr.BitLen()))
				includeCount++
			}
			continue
		}

		prefix, err := netip.ParsePrefix(cidr.String())
		if err != nil {
			return nil, nil, fmt.Errorf("invalid target %s: %w", raw, err)
		}
		if !prefixAllowed(prefix, opts) {
			return nil, nil, fmt.Errorf("target %s is not allowed (loopback/private)", raw)
		}
		builder.AddPrefix(prefix)
		includeCount++
		if host != "" && !utils.IsIp(host) {
			appendHost(cidr.IP.String(), host)
		}
	}

	if includeCount == 0 {
		return nil, nil, errors.New("no valid targets provided")
	}

	for _, raw := range excludes {
		raw = strings.TrimSpace(raw)
		if raw == "" {
			continue
		}
		cidr := utils.ParseCIDR(raw)
		if cidr == nil {
			return nil, nil, fmt.Errorf("invalid exclude: %s", raw)
		}
		prefix, err := netip.ParsePrefix(cidr.String())
		if err != nil {
			return nil, nil, fmt.Errorf("invalid exclude %s: %w", raw, err)
		}
		builder.RemovePrefix(prefix)
	}

	ipset, err := builder.IPSet()
	if err != nil {
		return nil, nil, err
	}

	var cidrs utils.CIDRs
	for _, p := range ipset.Prefixes() {
		cidr := utils.ParseCIDR(p.String())
		if cidr != nil {
			cidrs = append(cidrs, cidr)
		}
	}

	if len(cidrs) == 0 {
		return nil, nil, errors.New("no targets remain after applying excludes")
	}

	sort.SliceStable(cidrs, func(i, j int) bool { return cidrs[i].Compare(cidrs[j]) < 0 })
	return cidrs, hostMap, nil
}

func resolveHostRecords(host string, includeIPv6 bool) ([]netip.Addr, error) {
	ctx, cancel := context.WithTimeout(context.Background(), defaultResolveTimeout)
	defer cancel()

	ips, err := net.DefaultResolver.LookupIPAddr(ctx, host)
	if err != nil {
		return nil, err
	}

	seen := make(map[netip.Addr]struct{})
	results := make([]netip.Addr, 0, len(ips))
	for _, entry := range ips {
		addr, ok := netip.AddrFromSlice(entry.IP)
		if !ok {
			continue
		}
		if addr.Is4In6() {
			addr = addr.Unmap()
		}
		if addr.Is6() && !includeIPv6 {
			continue
		}
		if _, exists := seen[addr]; exists {
			continue
		}
		seen[addr] = struct{}{}
		results = append(results, addr)
	}
	return results, nil
}

func addrAllowed(addr netip.Addr, opts cidrBuildOptions) bool {
	if !addr.IsValid() {
		return false
	}
	if addr.IsUnspecified() || addr.IsMulticast() || addr.IsLinkLocalUnicast() || addr.IsLinkLocalMulticast() {
		return false
	}
	if addr.IsLoopback() && !opts.allowLoopback {
		return false
	}
	if addr.IsPrivate() && !opts.allowPrivate {
		return false
	}
	if !addr.IsGlobalUnicast() && !(addr.IsLoopback() && opts.allowLoopback) {
		return false
	}
	return true
}

func prefixAllowed(prefix netip.Prefix, opts cidrBuildOptions) bool {
	return addrAllowed(prefix.Addr(), opts)
}

func parsePreflightPorts(spec string) ([]int, error) {
	trimmed := strings.TrimSpace(spec)
	if trimmed == "" {
		trimmed = defaultPreflightPortsSpec
	}
	raw := utils.ParsePortsString(trimmed)
	if len(raw) == 0 {
		return nil, fmt.Errorf("no valid preflight ports resolved from %q", spec)
	}
	dedup := make(map[int]struct{}, len(raw))
	ports := make([]int, 0, len(raw))
	for _, entry := range raw {
		entry = strings.TrimSpace(entry)
		if entry == "" {
			continue
		}
		port, err := strconv.Atoi(entry)
		if err != nil || port <= 0 || port > 65535 {
			return nil, fmt.Errorf("invalid preflight port %q", entry)
		}
		if _, exists := dedup[port]; exists {
			continue
		}
		dedup[port] = struct{}{}
		ports = append(ports, port)
	}
	if len(ports) == 0 {
		return nil, fmt.Errorf("no numeric ports resolved from %q", spec)
	}
	sort.Ints(ports)
	return ports, nil
}

func runPreflight(ctx context.Context, ip string, cfg *preflightConfig) (bool, error) {
	if cfg == nil || len(cfg.ports) == 0 {
		return true, nil
	}

	dialer := &net.Dialer{Timeout: cfg.timeout}
	for _, port := range cfg.ports {
		select {
		case <-ctx.Done():
			return false, ctx.Err()
		default:
		}

		addr := net.JoinHostPort(ip, strconv.Itoa(port))
		conn, err := dialer.DialContext(ctx, "tcp", addr)
		if err == nil {
			conn.Close()
			return true, nil
		}
		if errors.Is(err, context.Canceled) {
			return false, ctx.Err()
		}
		if ne, ok := err.(net.Error); ok && ne.Timeout() {
			continue
		}
		// connection refused and other errors are treated as non-responsive and continue probing
	}
	return false, nil
}

func parsePorts(spec string) (ports []string, err error) {
	if strings.TrimSpace(spec) == "" {
		return defaultPorts(), nil
	}

	defer func() {
		if r := recover(); r != nil {
			err = fmt.Errorf("parse ports %q panic: %v", spec, r)
			ports = nil
		}
	}()

	raw := utils.ParsePortsString(strings.TrimSpace(spec))
	dedup := make(map[string]struct{}, len(raw))
	unique := make([]string, 0, len(raw))
	for _, port := range raw {
		port = strings.TrimSpace(port)
		if port == "" {
			continue
		}
		if _, exists := dedup[port]; exists {
			continue
		}
		dedup[port] = struct{}{}
		unique = append(unique, port)
	}
	unique = prioritizePorts(unique)
	if len(unique) == 0 {
		return nil, fmt.Errorf("no valid ports resolved from %q", spec)
	}
	return unique, nil
}

func prioritizePorts(ports []string) []string {
	if len(ports) <= 1 {
		return ports
	}

	original := make(map[string]struct{}, len(ports))
	for _, p := range ports {
		original[p] = struct{}{}
	}

	result := make([]string, 0, len(ports))
	seen := make(map[string]struct{}, len(ports))

	priorityNames := []string{"top1", "top2", "top3"}
	for _, name := range priorityNames {
		layer := utils.ParsePortsString(name)
		for _, port := range layer {
			if _, ok := original[port]; !ok {
				continue
			}
			if _, ok := seen[port]; ok {
				continue
			}
			seen[port] = struct{}{}
			result = append(result, port)
		}
	}

	for _, port := range ports {
		if _, ok := seen[port]; ok {
			continue
		}
		seen[port] = struct{}{}
		result = append(result, port)
	}

	return result
}

func collectFingerFiles(root string) []string {
	var files []string
	for _, dir := range []string{"fingers/http", "fingers/socket"} {
		path := filepath.Join(root, dir)
		filepath.Walk(path, func(p string, info os.FileInfo, err error) error {
			if err != nil {
				return nil
			}
			if info.IsDir() {
				return nil
			}
			if strings.HasSuffix(info.Name(), ".yaml") || strings.HasSuffix(info.Name(), ".json") {
				files = append(files, p)
			}
			return nil
		})
	}
	return files
}

func locateTemplateRoot() (string, error) {
	candidates := make([]string, 0, 8)

	if env := strings.TrimSpace(os.Getenv("MFINDER_TEMPLATES_DIR")); env != "" {
		candidates = append(candidates, env)
	}

	if wd, err := os.Getwd(); err == nil {
		candidates = append(candidates, filepath.Join(wd, "resources", "templates"))
	} else {
		candidates = append(candidates, filepath.Join("resources", "templates"))
	}

	if exePath, err := os.Executable(); err == nil {
		resolved := exePath
		if eval, err := filepath.EvalSymlinks(exePath); err == nil {
			resolved = eval
		}
		exeDir := filepath.Dir(resolved)
		candidates = append(candidates,
			filepath.Join(exeDir, "resources", "templates"),
			filepath.Join(filepath.Dir(exeDir), "resources", "templates"),
			filepath.Join(filepath.Dir(filepath.Dir(exeDir)), "resources", "templates"),
		)
	}

	seen := make(map[string]struct{}, len(candidates))
	unique := make([]string, 0, len(candidates))
	for _, candidate := range candidates {
		if _, ok := seen[candidate]; ok {
			continue
		}
		seen[candidate] = struct{}{}
		unique = append(unique, candidate)
	}

	for _, candidate := range unique {
		if info, err := os.Stat(candidate); err == nil && info.IsDir() {
			return candidate, nil
		}
	}

	return "", fmt.Errorf("templates directory not found; checked: %s", strings.Join(unique, ", "))
}

func loadExtractorFromFile(path string) error {
	if _, err := os.Stat(path); err != nil {
		return err
	}
	content, err := os.ReadFile(path)
	if err != nil {
		return err
	}
	var extractors []*parsers.Extractor
	if err := yaml.Unmarshal(content, &extractors); err != nil {
		return err
	}
	for _, extractor := range extractors {
		extractor.Compile()
	}
	gogopkg.Extractor = extractors
	gogopkg.ExtractRegexps = make(map[string][]*parsers.Extractor)
	for _, extractor := range extractors {
		gogopkg.ExtractRegexps[extractor.Name] = []*parsers.Extractor{extractor}
		for _, tag := range extractor.Tags {
			gogopkg.ExtractRegexps[tag] = append(gogopkg.ExtractRegexps[tag], extractor)
		}
	}
	return nil
}

func defaultPorts() []string {
	return []string{"top1"}
}

func sanitizeExploit(exploit string) string {
	trimmed := strings.TrimSpace(strings.ToLower(exploit))
	if trimmed == "" {
		return "none"
	}
	return trimmed
}

func sanitizeVerbose(verbose int) int {
	if verbose < 0 {
		return 0
	}
	if verbose > 3 {
		return 3
	}
	return verbose
}

func parseCIDRList(items []string) utils.CIDRs {
	cleaned := make([]string, 0, len(items))
	for _, raw := range items {
		raw = strings.TrimSpace(raw)
		if raw == "" {
			continue
		}
		cleaned = append(cleaned, raw)
	}
	if len(cleaned) == 0 {
		return nil
	}
	return utils.ParseCIDRs(cleaned)
}

func appendUnique(in []string, val string) []string {
	for _, existing := range in {
		if existing == val {
			return in
		}
	}
	return append(in, val)
}

func defaultThreadCount() int {
	cores := runtime.NumCPU()
	if cores <= 0 {
		cores = 1
	}
	base := cores * 8
	if base < 32 {
		base = 32
	}
	var max int
	switch runtime.GOOS {
	case "windows", "darwin":
		max = gogocore.WindowsMacDefaultThreads
	default:
		max = gogocore.LinuxDefaultThreads
	}
	if max > 0 && base > max {
		base = max
	}
	return base
}

func validateMode(mode string) error {
	trimmed := strings.TrimSpace(strings.ToLower(mode))
	if trimmed == "" || trimmed == defaultModeValue {
		return nil
	}
	return fmt.Errorf("scan mode %q is not supported yet", mode)
}
