package context

import "sync"

// 定义优先级
type priority int

const (
	priorityNone priority = iota
	priorityRunning
	priorityPausing
	priorityPaused
	priorityStop
	priorityError
	priorityCancel
)

// StatusContext 管理任务退出、错误、暂停等信号，遵循：cancel > error > stop > paused > pausing > running
type StatusContext struct {
	mu          sync.Mutex
	state       priority // 当前信号的优先级，初始为 priorityNone
	errChan     chan error
	doneChan    chan struct{}
	stopChan    chan struct{}
	pauseChan   chan struct{}
	pausingChan chan struct{}
	runningChan chan struct{}
	Err         error
}

func NewStatusContext() *StatusContext {
	return &StatusContext{
		state:       priorityNone,
		errChan:     make(chan error),
		doneChan:    make(chan struct{}),
		stopChan:    make(chan struct{}),
		pauseChan:   make(chan struct{}),
		pausingChan: make(chan struct{}),
		runningChan: make(chan struct{}),
	}
}

// 内部辅助，根据优先级是否可以更新状态，并执行对应 channel 的关闭
func (r *StatusContext) send(newState priority, closeFunc func()) {
	r.mu.Lock()
	defer r.mu.Unlock()
	// 如果已有信号优先级更高或等于新信号，则不更新
	if r.state >= newState {
		return
	}
	if newState > priorityError {
		r.Err = nil
	}
	// 更新状态为新信号的优先级
	r.state = newState
	// 执行关闭操作
	closeFunc()
}

func (r *StatusContext) Error() <-chan error {
	return r.errChan
}

func (r *StatusContext) Done() <-chan struct{} {
	return r.doneChan
}

func (r *StatusContext) Running() <-chan struct{} {
	return r.runningChan
}

func (r *StatusContext) Stop() <-chan struct{} {
	return r.stopChan
}

func (r *StatusContext) Paused() <-chan struct{} {
	return r.pauseChan
}

func (r *StatusContext) Pausing() <-chan struct{} {
	return r.pausingChan
}

func (r *StatusContext) Cancel() {
	r.send(priorityCancel, func() {
		// 可以记录内部错误状态
		close(r.doneChan)
	})
}

func (r *StatusContext) SendStop() {
	r.send(priorityStop, func() {
		close(r.stopChan)
	})
}

func (r *StatusContext) SendPause() {
	r.send(priorityPaused, func() {
		close(r.pauseChan)
	})
}

func (r *StatusContext) SendPausing() {
	r.send(priorityPausing, func() {
		close(r.pausingChan)
	})
}

func (r *StatusContext) SendError(err error) {
	r.send(priorityError, func() {
		r.Err = err
		close(r.errChan)
	})
}

func (r *StatusContext) SendRunning() {
	r.send(priorityRunning, func() {
		close(r.runningChan)
	})
}
