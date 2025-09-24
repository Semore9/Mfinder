package fingerprint

import "time"

// Result 表示指纹识别结果。
type Result struct {
	Service    string            `json:"service"`
	Product    string            `json:"product"`
	Version    string            `json:"version"`
	Confidence int               `json:"confidence"`
	Source     string            `json:"source"`
	Attributes map[string]string `json:"attributes,omitempty"`
	Raw        map[string]any    `json:"raw,omitempty"`
	Duration   time.Duration     `json:"duration"`
	Error      error             `json:"-"`
}

// Input 表示指纹识别的输入参数。
type Input struct {
	Host         string
	IP           string
	Port         int
	Scheme       string
	Hints        map[string]string
	PassiveAttrs map[string]string
}

// Collector 定义指纹采集接口。
type Collector interface {
	Collect(input Input) (Result, Evidence, error)
}

// Evidence 收集过程中得到的样本数据。
type Evidence struct {
	Banner       string
	HTTP         *HTTPInfo
	HTTPs        []HTTPInfo
	TLS          *TLSInfo
	Passive      map[string]string
	RawProtocols map[string]any
	FaviconHash  string
}

type HTTPInfo struct {
	Status     int
	Headers    map[string]string
	Title      string
	Server     string
	BodySample string
	URL        string
	Path       string
}

type TLSInfo struct {
	Version     string
	CipherSuite string
	CertIssuer  string
	CertSubject string
	SANs        []string
}

type MatchResult struct {
	Service    string
	Product    string
	Version    string
	Confidence int
	RuleID     string
	Tags       []string
}
