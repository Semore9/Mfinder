package gogoscan

import (
	"sort"
	"strings"

	"github.com/chainreactors/fingers/common"
	gogopkg "github.com/chainreactors/gogo/v2/pkg"
	"github.com/chainreactors/parsers"
)

// Result represents a sanitized, JSON friendly view of a gogo scanning outcome.
type Result struct {
	IP            string              `json:"ip"`
	Port          string              `json:"port"`
	Protocol      string              `json:"protocol"`
	Status        string              `json:"status"`
	URL           string              `json:"url"`
	BaseURL       string              `json:"baseUrl"`
	URI           string              `json:"uri,omitempty"`
	Host          string              `json:"host,omitempty"`
	Hosts         []string            `json:"hosts,omitempty"`
	ResolvedHosts []HostBinding       `json:"resolvedHosts,omitempty"`
	Worker        string              `json:"worker,omitempty"`
	Title         string              `json:"title,omitempty"`
	Midware       string              `json:"midware,omitempty"`
	Frameworks    []Framework         `json:"frameworks,omitempty"`
	Vulns         []Vuln              `json:"vulns,omitempty"`
	Extracts      map[string][]string `json:"extracts,omitempty"`

	raw *parsers.GOGOResult
}

// HostBinding captures the relationship between a domain/hostname and the IP it resolved to.
type HostBinding struct {
	Host       string `json:"host"`
	IP         string `json:"ip"`
	RecordType string `json:"recordType,omitempty"`
}

// Framework represents a detected technology signature on the remote service.
type Framework struct {
	Name    string   `json:"name"`
	Version string   `json:"version,omitempty"`
	Product string   `json:"product,omitempty"`
	Vendor  string   `json:"vendor,omitempty"`
	Tags    []string `json:"tags,omitempty"`
	Sources []string `json:"sources,omitempty"`
	CPE     string   `json:"cpe,omitempty"`
	WFN     string   `json:"wfn,omitempty"`
	Focus   bool     `json:"focus,omitempty"`
}

// Vuln represents a vulnerability finding yielded by neutron integration.
type Vuln struct {
	Name     string                 `json:"name"`
	Severity string                 `json:"severity"`
	Tags     []string               `json:"tags,omitempty"`
	Payload  map[string]interface{} `json:"payload,omitempty"`
	Detail   map[string][]string    `json:"detail,omitempty"`
}

// Raw exposes the underlying parsers.GOGOResult pointer for callers that need
// direct access to the original structure.
func (r Result) Raw() *parsers.GOGOResult {
	return r.raw
}

func convertResult(res *gogopkg.Result, hosts []string, worker string) Result {
	base := res.GOGOResult
	frameworks := make([]Framework, 0, len(base.Frameworks))
	for _, f := range base.Frameworks {
		frameworks = append(frameworks, convertFramework(f))
	}
	sort.SliceStable(frameworks, func(i, j int) bool { return frameworks[i].Name < frameworks[j].Name })

	vulns := make([]Vuln, 0, len(base.Vulns))
	for _, v := range base.Vulns {
		vulns = append(vulns, convertVuln(v))
	}
	sort.SliceStable(vulns, func(i, j int) bool { return vulns[i].Name < vulns[j].Name })

	extracts := make(map[string][]string, len(base.Extracteds))
	for k, list := range base.Extracteds {
		copied := append([]string(nil), list...)
		extracts[k] = copied
	}

	collectedHosts := append([]string(nil), hosts...)
	if h := strings.TrimSpace(base.Host); h != "" {
		collectedHosts = append(collectedHosts, h)
	}
	hostSet := make(map[string]struct{}, len(collectedHosts))
	hostCopy := make([]string, 0, len(collectedHosts))
	for _, host := range collectedHosts {
		host = strings.TrimSpace(host)
		if host == "" {
			continue
		}
		if _, exists := hostSet[host]; exists {
			continue
		}
		hostSet[host] = struct{}{}
		hostCopy = append(hostCopy, host)
	}
	sort.Strings(hostCopy)
	recordType := recordTypeForIP(base.Ip)
	bindings := make([]HostBinding, 0, len(hostCopy))
	for _, host := range hostCopy {
		bindings = append(bindings, HostBinding{Host: host, IP: base.Ip, RecordType: recordType})
	}

	return Result{
		IP:            base.Ip,
		Port:          base.Port,
		Protocol:      base.Protocol,
		Status:        base.Status,
		URL:           base.GetURL(),
		BaseURL:       base.GetBaseURL(),
		URI:           base.Uri,
		Host:          base.Host,
		Hosts:         hostCopy,
		ResolvedHosts: bindings,
		Worker:        worker,
		Title:         base.Title,
		Midware:       base.Midware,
		Frameworks:    frameworks,
		Vulns:         vulns,
		Extracts:      extracts,
		raw:           base,
	}
}

func convertFramework(f *common.Framework) Framework {
	if f == nil {
		return Framework{}
	}
	attrs := f.Attributes
	fw := Framework{
		Name:  f.Name,
		Tags:  append([]string(nil), f.Tags...),
		Focus: f.IsFocus,
	}
	if attrs != nil {
		fw.Product = attrs.Product
		fw.Vendor = attrs.Vendor
		fw.Version = attrs.Version
		if cpe := attrs.String(); cpe != "" {
			fw.CPE = cpe
		}
		if wfn := attrs.WFNString(); wfn != "" {
			fw.WFN = wfn
		}
	}
	sources := make([]string, 0, len(f.Froms))
	for from := range f.Froms {
		sources = append(sources, from.String())
	}
	sort.Strings(sources)
	fw.Sources = sources
	return fw
}

func convertVuln(v *common.Vuln) Vuln {
	if v == nil {
		return Vuln{}
	}
	sev := common.SeverityMap[v.SeverityLevel]
	if sev == "" {
		sev = "unknown"
	}
	return Vuln{
		Name:     v.Name,
		Severity: sev,
		Tags:     append([]string(nil), v.Tags...),
		Payload:  cloneAnyMap(v.Payload),
		Detail:   cloneStringSliceMap(v.Detail),
	}
}

func cloneAnyMap(in map[string]interface{}) map[string]interface{} {
	if len(in) == 0 {
		return nil
	}
	out := make(map[string]interface{}, len(in))
	for k, v := range in {
		out[k] = v
	}
	return out
}

func recordTypeForIP(ip string) string {
	ip = strings.TrimSpace(ip)
	if ip == "" {
		return ""
	}
	if strings.Contains(ip, ":") {
		return "AAAA"
	}
	return "A"
}

func cloneStringSliceMap(in map[string][]string) map[string][]string {
	if len(in) == 0 {
		return nil
	}
	out := make(map[string][]string, len(in))
	for k, v := range in {
		out[k] = append([]string(nil), v...)
	}
	return out
}
