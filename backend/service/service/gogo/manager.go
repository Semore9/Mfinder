package gogo

import (
	"context"
	"errors"
	"runtime/debug"
	"sort"
	"strings"
	"sync"
	"time"

	"mfinder/backend/application"
	"mfinder/backend/constant/event"
	"mfinder/backend/constant/status"
	gogoscan "mfinder/backend/scanner/gogo"

	"github.com/yitter/idgenerator-go/idgen"
)

type runtimeState struct {
	cancel context.CancelFunc
	done   chan struct{}
}

// Manager coordinates gogo scan tasks and pushes progress through the event bus.
type Manager struct {
	app    *application.Application
	engine *gogoscan.Engine

	mu       sync.RWMutex
	tasks    map[int64]*Task
	runtimes map[int64]*runtimeState
}

func NewManager(app *application.Application, engine *gogoscan.Engine) *Manager {
	return &Manager{
		app:      app,
		engine:   engine,
		tasks:    make(map[int64]*Task),
		runtimes: make(map[int64]*runtimeState),
	}
}

func (m *Manager) StartTask(params gogoscan.ScanParams) (task *Task, err error) {
	defer func() {
		if r := recover(); r != nil {
			stack := debug.Stack()
			m.app.Logger.Errorf("panic in gogo StartTask: %v\n%s", r, string(stack))
			err = errors.New("gogo start task panic")
		}
	}()

	params = params.WithDefaults(m.engine.Defaults())

	ipCount, portCount, err := m.engine.EstimateWorkload(params)
	if err != nil {
		return nil, err
	}

	ctx, cancel := context.WithCancel(context.Background())
	resultCh, progressCh, errCh, err := m.engine.Run(ctx, params)
	if err != nil {
		cancel()
		return nil, err
	}

	now := time.Now()
	taskID := idgen.NextId()
	task = &Task{
		ID:        taskID,
		Status:    status.Running,
		CreatedAt: now,
		StartedAt: now,
		Params:    params,
		Worker:    strings.TrimSpace(params.Worker),
		Metrics: TaskMetrics{
			TargetCount: ipCount,
			PortCount:   portCount,
			Planned:     ipCount * portCount,
		},
	}

	rt := &runtimeState{
		cancel: cancel,
		done:   make(chan struct{}),
	}

	m.mu.Lock()
	m.tasks[taskID] = task
	m.runtimes[taskID] = rt
	metricsSnapshot := task.Metrics
	m.mu.Unlock()

	m.emit(taskID, status.Running, metricsSnapshot, nil, nil, "started", "")

	go m.consume(taskID, task, rt, ctx, resultCh, progressCh, errCh)

	return cloneTask(task), nil
}

func (m *Manager) consume(taskID int64, task *Task, rt *runtimeState, ctx context.Context, results <-chan gogoscan.Result, progressCh <-chan gogoscan.Progress, errs <-chan error) {
	defer close(rt.done)

	resultCh := results
	errCh := errs
	progCh := progressCh
	var finalErr error
	pendingResults := make([]gogoscan.Result, 0, 32)
	flushTicker := time.NewTicker(200 * time.Millisecond)
	defer flushTicker.Stop()
	lastFlush := time.Now()

	flush := func(force bool) {
		if len(pendingResults) == 0 {
			return
		}
		if !force && time.Since(lastFlush) < 50*time.Millisecond {
			return
		}
		batch := make([]gogoscan.Result, len(pendingResults))
		copy(batch, pendingResults)
		pendingResults = pendingResults[:0]
		lastFlush = time.Now()

		m.mu.RLock()
		metrics := task.Metrics
		statusCode := task.Status
		m.mu.RUnlock()

		m.emit(taskID, statusCode, metrics, nil, batch, "", "")
	}

	for resultCh != nil || errCh != nil || progCh != nil {
		select {
		case res, ok := <-resultCh:
			if !ok {
				resultCh = nil
				continue
			}
			m.mu.Lock()
			task.Metrics.ResultCount++
			task.Metrics.LastResult = time.Now()
			m.mu.Unlock()
			pendingResults = append(pendingResults, res)
			if len(pendingResults) >= 25 {
				flush(true)
			}
		case prog, ok := <-progCh:
			if !ok {
				progCh = nil
				continue
			}
			m.mu.Lock()
			task.Metrics.Enqueued = prog.Enqueued
			task.Metrics.Started = prog.Started
			task.Metrics.Succeeded = prog.Succeeded
			task.Metrics.Failed = prog.Failed
			task.Metrics.TimedOut = prog.TimedOut
			task.Metrics.Planned = prog.Planned
			task.Metrics.Active = prog.Active
			task.Metrics.PPS = prog.PPS
			task.Metrics.UptimeMs = prog.UptimeMs
			metrics := task.Metrics
			m.mu.Unlock()
			m.emit(taskID, status.Running, metrics, nil, nil, "", "")
		case err, ok := <-errCh:
			if !ok {
				errCh = nil
				continue
			}
			if err != nil && !errors.Is(err, context.Canceled) {
				finalErr = err
				m.mu.Lock()
				task.Status = status.Error
				task.Error = err.Error()
				metrics := task.Metrics
				m.mu.Unlock()
				flush(true)
				m.emit(taskID, status.Error, metrics, nil, nil, "", err.Error())
			}
		case <-ctx.Done():
			if finalErr == nil {
				finalErr = ctx.Err()
			}
		case <-flushTicker.C:
			flush(false)
		}
	}

	flush(true)

	m.mu.Lock()
	delete(m.runtimes, taskID)
	task.CompletedAt = time.Now()
	metrics := task.Metrics

	if task.Status != status.Error {
		if finalErr != nil && !errors.Is(finalErr, context.Canceled) {
			task.Status = status.Error
			task.Error = finalErr.Error()
		} else if ctx.Err() == context.Canceled {
			task.Status = status.Stopped
		} else {
			task.Status = status.OK
		}
	}

	finalStatus := task.Status
	finalError := task.Error
	m.mu.Unlock()

	if finalError == "" && finalErr != nil && !errors.Is(finalErr, context.Canceled) {
		finalError = finalErr.Error()
	}

	m.emit(taskID, finalStatus, metrics, nil, nil, "completed", finalError)
}

func (m *Manager) StopTask(taskID int64) error {
	m.mu.RLock()
	rt, ok := m.runtimes[taskID]
	m.mu.RUnlock()
	if !ok {
		return errors.New("task not running or does not exist")
	}
	rt.cancel()
	return nil
}

func (m *Manager) GetTask(taskID int64) (*Task, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	task, ok := m.tasks[taskID]
	if !ok {
		return nil, errors.New("task not found")
	}
	return cloneTask(task), nil
}

func (m *Manager) ListTasks() []*Task {
	m.mu.RLock()
	defer m.mu.RUnlock()
	list := make([]*Task, 0, len(m.tasks))
	for _, task := range m.tasks {
		list = append(list, cloneTask(task))
	}
	sort.Slice(list, func(i, j int) bool {
		return list[i].CreatedAt.Before(list[j].CreatedAt)
	})
	return list
}

func (m *Manager) UpdateDefaults(opts gogoscan.DefaultOptions) {
	m.engine.UpdateDefaults(opts)
}

func (m *Manager) emit(taskID int64, statusCode int, metrics TaskMetrics, result *gogoscan.Result, batch []gogoscan.Result, message, errMsg string) {
	payload := TaskEvent{
		TaskID:  taskID,
		Status:  statusCode,
		Metrics: metrics,
		Message: message,
		Error:   errMsg,
	}
	if result != nil {
		tmp := *result
		payload.Result = &tmp
	}
	if len(batch) > 0 {
		payload.Results = append(payload.Results, batch...)
	}
	event.EmitV2(event.GogoTaskUpdate, event.EventDetail{
		ID:      taskID,
		Status:  statusCode,
		Message: message,
		Error:   errMsg,
		Data:    payload,
	})
}

func cloneTask(t *Task) *Task {
	if t == nil {
		return nil
	}
	cp := *t
	cp.Params = cloneScanParams(t.Params)
	return &cp
}

func cloneScanParams(p gogoscan.ScanParams) gogoscan.ScanParams {
	cp := p
	cp.Targets = append([]string(nil), p.Targets...)
	cp.Exclude = append([]string(nil), p.Exclude...)
	return cp
}
