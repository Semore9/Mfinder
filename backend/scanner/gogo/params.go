package gogoscan

import (
	"strings"
)

type ConcurrencyMode string

const (
	ConcurrencyModeAuto   ConcurrencyMode = "auto"
	ConcurrencyModeManual ConcurrencyMode = "manual"
)

// ConcurrencyOptions captures how the engine should allocate workers and rate-limit traffic.
type ConcurrencyOptions struct {
	Mode        ConcurrencyMode `json:"mode,omitempty"`
	Threads     int             `json:"threads,omitempty"`
	MaxThreads  int             `json:"maxThreads,omitempty"`
	MaxPPS      int             `json:"maxPps,omitempty"`
	PerIPMaxPPS int             `json:"perIpMaxPps,omitempty"`
}

// DefaultOptions captures the baseline tuning values that will be applied to new scan requests
// when the caller does not specify an explicit value.
type DefaultOptions struct {
	Ports            string
	Mode             string
	Delay            int
	HTTPSDelay       int
	Exploit          string
	Verbose          int
	PortProbe        string
	IPProbe          string
	ResolveHosts     bool
	ResolveIPv6      bool
	PreflightEnabled bool
	PreflightPorts   string
	PreflightTimeout int
	AllowLoopback    bool
	AllowPrivate     bool
	Worker           string
	Concurrency      ConcurrencyOptions
}

// ScanParams models the user supplied parameters for kick-starting a gogo scan task.
type ScanParams struct {
	Targets     []string `json:"targets"`
	Target      string   `json:"target"`
	TargetsText string   `json:"targetsText"`

	Ports string `json:"ports"`
	Mode  string `json:"mode"`

	Ping   bool `json:"ping"`
	NoScan bool `json:"noScan"`

	Delay      int `json:"delay"`
	HTTPSDelay int `json:"httpsDelay"`

	Exploit   string `json:"exploit"`
	Verbose   int    `json:"verbose"`
	PortProbe string `json:"portProbe"`
	IPProbe   string `json:"ipProbe"`

	Exclude  []string `json:"exclude"`
	Workflow string   `json:"workflow"`

	Debug bool `json:"debug"`
	Opsec bool `json:"opsec"`

	ResolveHosts     bool               `json:"resolveHosts"`
	ResolveIPv6      bool               `json:"resolveIPv6"`
	PreflightEnabled bool               `json:"preflightEnabled"`
	PreflightPorts   string             `json:"preflightPorts"`
	PreflightTimeout int                `json:"preflightTimeout"`
	AllowLoopback    bool               `json:"allowLoopback"`
	AllowPrivate     bool               `json:"allowPrivate"`
	Worker           string             `json:"worker"`
	Concurrency      ConcurrencyOptions `json:"concurrency"`

	// Deprecated: Threads is kept for backward compatibility. Use Concurrency.Mode=manual and
	// Concurrency.Threads instead.
	Threads int `json:"threads"`
}

// WithDefaults returns a copy of the scan parameters where empty fields are
// populated from the provided defaults.
func (p ScanParams) WithDefaults(d DefaultOptions) ScanParams {
	cp := p
	if strings.TrimSpace(cp.Ports) == "" {
		cp.Ports = d.Ports
	}
	if strings.TrimSpace(cp.Mode) == "" {
		cp.Mode = d.Mode
	}
	if cp.Delay <= 0 {
		cp.Delay = d.Delay
	}
	if cp.HTTPSDelay < 0 {
		cp.HTTPSDelay = d.HTTPSDelay
	}
	if strings.TrimSpace(cp.Exploit) == "" {
		cp.Exploit = d.Exploit
	}
	if cp.Verbose < 0 {
		cp.Verbose = d.Verbose
	}
	if strings.TrimSpace(cp.PortProbe) == "" {
		cp.PortProbe = d.PortProbe
	}
	if strings.TrimSpace(cp.IPProbe) == "" {
		cp.IPProbe = d.IPProbe
	}
	cp.ResolveHosts = d.ResolveHosts || cp.ResolveHosts
	cp.ResolveIPv6 = d.ResolveIPv6 || cp.ResolveIPv6
	if strings.TrimSpace(cp.PreflightPorts) == "" {
		cp.PreflightPorts = d.PreflightPorts
	}
	if cp.PreflightTimeout <= 0 {
		cp.PreflightTimeout = d.PreflightTimeout
	}
	cp.PreflightEnabled = cp.PreflightEnabled || d.PreflightEnabled
	cp.AllowLoopback = cp.AllowLoopback || d.AllowLoopback
	cp.AllowPrivate = cp.AllowPrivate || d.AllowPrivate
	if trimmed := strings.TrimSpace(cp.Worker); trimmed != "" {
		cp.Worker = trimmed
	} else {
		cp.Worker = strings.TrimSpace(d.Worker)
	}
	cp.Concurrency, cp.Threads = mergeConcurrencyOptions(cp.Concurrency, cp.Threads, d.Concurrency)
	return cp
}

// NormalizedTargets flattens different target input variants into a unique, ordered
// slice of non-empty strings ready for downstream parsing.
func (p ScanParams) NormalizedTargets() []string {
	dedup := make(map[string]struct{})
	ordered := make([]string, 0)

	appendTarget := func(raw string) {
		raw = strings.TrimSpace(raw)
		if raw == "" {
			return
		}
		if _, exists := dedup[raw]; exists {
			return
		}
		dedup[raw] = struct{}{}
		ordered = append(ordered, raw)
	}

	for _, t := range p.Targets {
		appendTarget(t)
	}

	for _, t := range splitTargetString(p.Target) {
		appendTarget(t)
	}

	for _, t := range splitTargetString(p.TargetsText) {
		appendTarget(t)
	}

	return ordered
}

func splitTargetString(raw string) []string {
	if strings.TrimSpace(raw) == "" {
		return nil
	}
	separators := func(r rune) bool {
		switch r {
		case '\n', '\r', '\t', ',', ';':
			return true
		default:
			return false
		}
	}
	segments := strings.FieldsFunc(raw, separators)
	out := make([]string, 0, len(segments))
	for _, seg := range segments {
		seg = strings.TrimSpace(seg)
		if seg == "" {
			continue
		}
		out = append(out, seg)
	}
	return out
}

func mergeConcurrencyOptions(user ConcurrencyOptions, legacyThreads int, defaults ConcurrencyOptions) (ConcurrencyOptions, int) {
	result := defaults
	mode := normalizeConcurrencyMode(user.Mode)
	if mode == "" {
		if legacyThreads > 0 {
			mode = ConcurrencyModeManual
		} else {
			mode = normalizeConcurrencyMode(defaults.Mode)
		}
	}
	if mode == "" {
		mode = ConcurrencyModeAuto
	}
	result.Mode = mode
	compatThreads := 0

	switch mode {
	case ConcurrencyModeManual:
		threads := user.Threads
		if threads <= 0 {
			threads = legacyThreads
		}
		if threads <= 0 {
			threads = defaults.Threads
		}
		if threads <= 0 {
			threads = 64
		}
		result.Threads = threads
		compatThreads = threads

		if user.MaxPPS > 0 {
			result.MaxPPS = user.MaxPPS
		}
		if result.MaxPPS < 0 {
			result.MaxPPS = 0
		}
		if user.PerIPMaxPPS > 0 {
			result.PerIPMaxPPS = user.PerIPMaxPPS
		}
		if result.PerIPMaxPPS < 0 {
			result.PerIPMaxPPS = 0
		}
		result.MaxThreads = 0

	default:
		if user.MaxThreads > 0 {
			result.MaxThreads = user.MaxThreads
		}
		if result.MaxThreads <= 0 {
			result.MaxThreads = defaults.MaxThreads
		}
		if result.MaxThreads <= 0 {
			result.MaxThreads = 512
		}
		if user.MaxPPS > 0 {
			result.MaxPPS = user.MaxPPS
		}
		if result.MaxPPS < 0 {
			result.MaxPPS = 0
		}
		if user.PerIPMaxPPS > 0 {
			result.PerIPMaxPPS = user.PerIPMaxPPS
		}
		if result.PerIPMaxPPS < 0 {
			result.PerIPMaxPPS = 0
		}
		result.Threads = 0
	}

	return result, compatThreads
}

func normalizeConcurrencyMode(mode ConcurrencyMode) ConcurrencyMode {
	switch strings.ToLower(strings.TrimSpace(string(mode))) {
	case string(ConcurrencyModeManual):
		return ConcurrencyModeManual
	case string(ConcurrencyModeAuto):
		return ConcurrencyModeAuto
	default:
		return ""
	}
}
