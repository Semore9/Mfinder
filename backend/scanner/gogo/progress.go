package gogoscan

import (
	"context"
	"strings"
	"time"
)

type Progress struct {
	Planned   int       `json:"planned"`
	Enqueued  int       `json:"enqueued"`
	Started   int       `json:"started"`
	Succeeded int       `json:"succeeded"`
	Failed    int       `json:"failed"`
	TimedOut  int       `json:"timedOut"`
	Active    int       `json:"active"`
	PPS       float64   `json:"pps"`
	UptimeMs  int64     `json:"uptimeMs"`
	Timestamp time.Time `json:"timestamp"`
}

type progressEvent struct {
	kind  string
	count int
}

type progressReporter struct {
	planned int
	ch      chan progressEvent
	out     chan<- Progress
	ctx     context.Context
	done    chan struct{}
	conc    *concurrencyManager
}

func newProgressReporter(ctx context.Context, out chan<- Progress, planned int, conc *concurrencyManager) *progressReporter {
	reporter := &progressReporter{
		planned: planned,
		ch:      make(chan progressEvent, 128),
		out:     out,
		ctx:     ctx,
		done:    make(chan struct{}),
		conc:    conc,
	}
	go reporter.loop()
	return reporter
}

func (r *progressReporter) loop() {
	defer close(r.done)

	ticker := time.NewTicker(200 * time.Millisecond)
	defer ticker.Stop()

	var snapshot Progress
	snapshot.Planned = r.planned
	pending := false

	flush := func() {
		if !pending {
			return
		}
		snapshot.Timestamp = time.Now()
		snapshot.Active = snapshot.Started - snapshot.Succeeded - snapshot.Failed - snapshot.TimedOut
		if snapshot.Active < 0 {
			snapshot.Active = 0
		}
		if r.conc != nil {
			snapshot.PPS = r.conc.EffectivePPS()
			snapshot.UptimeMs = r.conc.Uptime().Milliseconds()
		} else {
			snapshot.PPS = 0
			snapshot.UptimeMs = 0
		}
		select {
		case r.out <- snapshot:
		case <-r.ctx.Done():
		}
		pending = false
	}

	for {
		select {
		case <-r.ctx.Done():
			flush()
			return
		case ev, ok := <-r.ch:
			if !ok {
				flush()
				return
			}
			switch ev.kind {
			case "enqueued":
				snapshot.Enqueued += ev.count
			case "started":
				snapshot.Started += ev.count
			case "succeeded":
				snapshot.Succeeded += ev.count
			case "failed":
				snapshot.Failed += ev.count
			case "timeout":
				snapshot.TimedOut += ev.count
			}

			pending = true
		case <-ticker.C:
			pending = true
			flush()
		}
	}
}

func (r *progressReporter) Enqueued(n int) {
	r.send(progressEvent{kind: "enqueued", count: n})
}

func (r *progressReporter) Started(n int) {
	r.send(progressEvent{kind: "started", count: n})
}

func (r *progressReporter) Succeeded(n int) {
	r.send(progressEvent{kind: "succeeded", count: n})
}

func (r *progressReporter) Failed(n int) {
	r.send(progressEvent{kind: "failed", count: n})
}

func (r *progressReporter) TimedOut(n int) {
	r.send(progressEvent{kind: "timeout", count: n})
}

func (r *progressReporter) send(ev progressEvent) {
	select {
	case r.ch <- ev:
	case <-r.ctx.Done():
	}
}

func (r *progressReporter) Close() {
	close(r.ch)
	<-r.done
}

func classifyStatus(status string) (timeout bool) {
	status = strings.ToLower(status)
	if status == "" {
		return false
	}
	if strings.Contains(status, "timeout") || strings.Contains(status, "timed out") {
		return true
	}
	return false
}
