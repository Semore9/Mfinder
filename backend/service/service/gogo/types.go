package gogo

import (
	"time"

	"mfinder/backend/scanner/gogo"
)

// Task describes a running or completed gogo scan job.
type Task struct {
	ID          int64               `json:"id"`
	Status      int                 `json:"status"`
	CreatedAt   time.Time           `json:"createdAt"`
	StartedAt   time.Time           `json:"startedAt"`
	CompletedAt time.Time           `json:"completedAt"`
	Params      gogoscan.ScanParams `json:"params"`
	Metrics     TaskMetrics         `json:"metrics"`
	Error       string              `json:"error,omitempty"`
	Worker      string              `json:"worker,omitempty"`
}

// TaskMetrics keeps lightweight counters used by the UI to render progress.
type TaskMetrics struct {
	TargetCount int       `json:"targetCount"`
	PortCount   int       `json:"portCount"`
	ResultCount int       `json:"resultCount"`
	LastResult  time.Time `json:"lastResult"`
	Planned     int       `json:"planned"`
	Enqueued    int       `json:"enqueued"`
	Started     int       `json:"started"`
	Succeeded   int       `json:"succeeded"`
	Failed      int       `json:"failed"`
	TimedOut    int       `json:"timedOut"`
	Active      int       `json:"active"`
	PPS         float64   `json:"pps"`
	UptimeMs    int64     `json:"uptimeMs"`
}

// TaskEvent payload emitted over Wails event bus to notify the UI about
// status changes or new results.
type TaskEvent struct {
	TaskID  int64             `json:"taskId"`
	Status  int               `json:"status"`
	Result  *gogoscan.Result  `json:"result,omitempty"`
	Results []gogoscan.Result `json:"results,omitempty"`
	Metrics TaskMetrics       `json:"metrics"`
	Message string            `json:"message,omitempty"`
	Error   string            `json:"error,omitempty"`
}
