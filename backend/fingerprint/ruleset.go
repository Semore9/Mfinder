package fingerprint

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"regexp"
	"strings"
)

// Rule 定义指纹匹配规则。
type Rule struct {
	ID         string          `json:"id"`
	Service    string          `json:"service"`
	Product    string          `json:"product"`
	Version    string          `json:"version"`
	Confidence int             `json:"confidence"`
	Ports      []int           `json:"ports"`
	Protocols  []string        `json:"protocols"`
	Matchers   []MatcherConfig `json:"matchers"`
	Tags       []string        `json:"tags"`
}

// MatcherConfig 描述具体匹配条件。
type MatcherConfig struct {
	Type       string `json:"type"`
	Key        string `json:"key"`
	Pattern    string `json:"pattern"`
	Contains   string `json:"contains"`
	Equals     string `json:"equals"`
	IgnoreCase bool   `json:"ignoreCase"`
}

// RuleSet 保存规则列表及预编译状态。
type RuleSet struct {
	rules []compiledRule
}

type compiledRule struct {
	raw      Rule
	matchers []matcherFunc
}

type matcherFunc func(input Input, evidence Evidence) bool

func LoadRuleSet(path string) (*RuleSet, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	return ParseRuleSet(data)
}

func ParseRuleSet(data []byte) (*RuleSet, error) {
	var list []Rule
	if err := json.Unmarshal(data, &list); err != nil {
		return nil, fmt.Errorf("parse fingerprint rules: %w", err)
	}
	return compileRules(list)
}

func compileRules(list []Rule) (*RuleSet, error) {
	rs := &RuleSet{}
	for _, rule := range list {
		if rule.ID == "" {
			return nil, errors.New("rule missing id")
		}
		compiled, err := compileRule(rule)
		if err != nil {
			return nil, fmt.Errorf("compile rule %s: %w", rule.ID, err)
		}
		rs.rules = append(rs.rules, compiled)
	}
	return rs, nil
}

func compileRule(rule Rule) (compiledRule, error) {
	cr := compiledRule{raw: rule}
	for _, cfg := range rule.Matchers {
		mf, err := buildMatcher(cfg)
		if err != nil {
			return compiledRule{}, err
		}
		cr.matchers = append(cr.matchers, mf)
	}
	return cr, nil
}

func buildMatcher(cfg MatcherConfig) (matcherFunc, error) {
	switch cfg.Type {
	case "banner":
		re, err := compilePattern(cfg)
		if err != nil {
			return nil, err
		}
		return func(_ Input, ev Evidence) bool {
			return re.MatchString(ev.Banner)
		}, nil
	case "http_header":
		re, err := compilePattern(cfg)
		if err != nil {
			return nil, err
		}
		key := strings.ToLower(cfg.Key)
		return func(_ Input, ev Evidence) bool {
			for _, info := range gatherHTTPInfos(ev) {
				if re.MatchString(info.Headers[key]) {
					return true
				}
			}
			return false
		}, nil
	case "http_title":
		re, err := compilePattern(cfg)
		if err != nil {
			return nil, err
		}
		return func(_ Input, ev Evidence) bool {
			for _, info := range gatherHTTPInfos(ev) {
				if re.MatchString(info.Title) {
					return true
				}
			}
			return false
		}, nil
	case "http_body":
		re, err := compilePattern(cfg)
		if err != nil {
			return nil, err
		}
		return func(_ Input, ev Evidence) bool {
			for _, info := range gatherHTTPInfos(ev) {
				if re.MatchString(info.BodySample) {
					return true
				}
			}
			return false
		}, nil
	case "http_header_any":
		re, err := compilePattern(cfg)
		if err != nil {
			return nil, err
		}
		return func(_ Input, ev Evidence) bool {
			for _, info := range gatherHTTPInfos(ev) {
				for _, val := range info.Headers {
					if re.MatchString(val) {
						return true
					}
				}
			}
			return false
		}, nil
	case "http_favicon":
		expected := strings.TrimSpace(cfg.Equals)
		if expected == "" {
			return nil, errors.New("empty favicon matcher")
		}
		return func(_ Input, ev Evidence) bool {
			return strings.EqualFold(ev.FaviconHash, expected)
		}, nil
	case "tls_subject":
		re, err := compilePattern(cfg)
		if err != nil {
			return nil, err
		}
		return func(_ Input, ev Evidence) bool {
			if ev.TLS == nil {
				return false
			}
			return re.MatchString(ev.TLS.CertSubject)
		}, nil
	case "passive":
		re, err := compilePattern(cfg)
		if err != nil {
			return nil, err
		}
		key := strings.ToLower(cfg.Key)
		return func(_ Input, ev Evidence) bool {
			val := ev.Passive[key]
			return re.MatchString(val)
		}, nil
	default:
		return nil, fmt.Errorf("unknown matcher type %s", cfg.Type)
	}
}

func gatherHTTPInfos(ev Evidence) []HTTPInfo {
	if len(ev.HTTPs) > 0 {
		return ev.HTTPs
	}
	if ev.HTTP != nil {
		return []HTTPInfo{*ev.HTTP}
	}
	return nil
}

func compilePattern(cfg MatcherConfig) (*regexp.Regexp, error) {
	if cfg.Pattern != "" {
		if cfg.IgnoreCase {
			return regexp.Compile("(?i)" + cfg.Pattern)
		}
		return regexp.Compile(cfg.Pattern)
	}
	var pattern string
	if cfg.Contains != "" {
		pattern = regexp.QuoteMeta(cfg.Contains)
	} else if cfg.Equals != "" {
		pattern = "^" + regexp.QuoteMeta(cfg.Equals) + "$"
	}
	if pattern == "" {
		return nil, errors.New("empty matcher pattern")
	}
	if cfg.IgnoreCase {
		pattern = "(?i)" + pattern
	}
	return regexp.Compile(pattern)
}

func (rs *RuleSet) Match(input Input, evidence Evidence) MatchResult {
	for _, rule := range rs.rules {
		if !ruleMatchesPort(rule.raw, input.Port) || !ruleMatchesProto(rule.raw, input.Scheme) {
			continue
		}
		matched := true
		for _, fn := range rule.matchers {
			if !fn(input, evidence) {
				matched = false
				break
			}
		}
		if matched {
			return MatchResult{
				Service:    rule.raw.Service,
				Product:    rule.raw.Product,
				Version:    rule.raw.Version,
				Confidence: rule.raw.Confidence,
				RuleID:     rule.raw.ID,
				Tags:       rule.raw.Tags,
			}
		}
	}
	return MatchResult{}
}

func ruleMatchesPort(rule Rule, port int) bool {
	if len(rule.Ports) == 0 {
		return true
	}
	for _, p := range rule.Ports {
		if p == port {
			return true
		}
	}
	return false
}

func ruleMatchesProto(rule Rule, proto string) bool {
	if len(rule.Protocols) == 0 {
		return true
	}
	proto = strings.ToLower(proto)
	for _, p := range rule.Protocols {
		if strings.ToLower(p) == proto {
			return true
		}
	}
	return false
}
