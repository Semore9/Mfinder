package gogo

import (
	"strings"
	"time"

	"mfinder/backend/application"
	"mfinder/backend/config"
	gogoscan "mfinder/backend/scanner/gogo"
)

// Bridge exposes gogo scanning capabilities to the Wails runtime.
type Bridge struct {
	app     *application.Application
	manager *Manager
}

func NewBridge(app *application.Application) *Bridge {
	engine := gogoscan.NewEngine(defaultOptionsFromConfig(app.Config.Gogo))
	return &Bridge{
		app:     app,
		manager: NewManager(app, engine),
	}
}

func (b *Bridge) StartTask(params gogoscan.ScanParams) (*Task, error) {
	return b.manager.StartTask(params)
}

func (b *Bridge) StopTask(taskID int64) error {
	return b.manager.StopTask(taskID)
}

func (b *Bridge) GetTask(taskID int64) (*Task, error) {
	return b.manager.GetTask(taskID)
}

func (b *Bridge) ListTasks() []*Task {
	return b.manager.ListTasks()
}

func (b *Bridge) GetDefaults() config.Gogo {
	return b.app.Config.Gogo
}

func (b *Bridge) SaveDefaults(cfg config.Gogo) error {
	b.app.Config.Gogo = cfg
	if err := b.app.WriteConfig(b.app.Config); err != nil {
		b.app.Logger.Error(err)
		return err
	}
	b.manager.UpdateDefaults(defaultOptionsFromConfig(cfg))
	return nil
}

func defaultOptionsFromConfig(cfg config.Gogo) gogoscan.DefaultOptions {
	return gogoscan.DefaultOptions{
		Ports:            cfg.Ports,
		Mode:             cfg.Mode,
		Delay:            durationToSeconds(cfg.Delay),
		HTTPSDelay:       durationToSeconds(cfg.HTTPSDelay),
		Exploit:          cfg.Exploit,
		Verbose:          cfg.Verbose,
		ResolveHosts:     cfg.ResolveHosts,
		ResolveIPv6:      cfg.ResolveIPv6,
		PreflightEnabled: cfg.PreflightEnable,
		PreflightPorts:   cfg.PreflightPorts,
		PreflightTimeout: durationToMillis(cfg.PreflightTimeout),
		AllowLoopback:    cfg.AllowLoopback,
		AllowPrivate:     cfg.AllowPrivate,
		Worker:           cfg.WorkerLabel,
		Concurrency:      deriveConcurrencyOptions(cfg),
	}
}

func deriveConcurrencyOptions(cfg config.Gogo) gogoscan.ConcurrencyOptions {
	mode := strings.ToLower(strings.TrimSpace(cfg.ConcurrencyMode))
	options := gogoscan.ConcurrencyOptions{}
	switch mode {
	case string(gogoscan.ConcurrencyModeManual):
		options.Mode = gogoscan.ConcurrencyModeManual
		options.Threads = cfg.ConcurrencyThreads
	case string(gogoscan.ConcurrencyModeAuto):
		options.Mode = gogoscan.ConcurrencyModeAuto
		options.MaxThreads = cfg.ConcurrencyMaxThreads
		options.MaxPPS = cfg.ConcurrencyMaxPps
		options.PerIPMaxPPS = cfg.ConcurrencyPerIpMaxPps
	default:
		if cfg.Threads > 0 {
			options.Mode = gogoscan.ConcurrencyModeManual
			options.Threads = cfg.Threads
		} else {
			options.Mode = gogoscan.ConcurrencyModeAuto
			options.MaxThreads = cfg.ConcurrencyMaxThreads
			options.MaxPPS = cfg.ConcurrencyMaxPps
			options.PerIPMaxPPS = cfg.ConcurrencyPerIpMaxPps
		}
	}
	if options.Mode == gogoscan.ConcurrencyModeManual {
		if options.Threads <= 0 {
			options.Threads = cfg.ConcurrencyThreads
		}
		if options.Threads <= 0 {
			options.Threads = cfg.Threads
		}
		if cfg.ConcurrencyMaxPps > 0 {
			options.MaxPPS = cfg.ConcurrencyMaxPps
		}
		if cfg.ConcurrencyPerIpMaxPps > 0 {
			options.PerIPMaxPPS = cfg.ConcurrencyPerIpMaxPps
		}
	}
	return options
}

func durationToSeconds(d time.Duration) int {
	if d <= 0 {
		return 0
	}
	return int(d / time.Second)
}

func durationToMillis(d time.Duration) int {
	if d <= 0 {
		return 0
	}
	return int(d / time.Millisecond)
}
