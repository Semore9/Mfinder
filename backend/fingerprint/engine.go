package fingerprint

import (
	"errors"
)

// Engine 聚合采集与规则匹配。
type Engine struct {
	Collector Collector
	Rules     *RuleSet
}

func NewEngine(collector Collector, rules *RuleSet) *Engine {
	return &Engine{Collector: collector, Rules: rules}
}

func (e *Engine) Identify(input Input) Result {
	if e.Collector == nil {
		return Result{Error: errNoCollector}
	}
	result, evidence, err := e.collect(input)
	if err != nil {
		result.Error = err
		return result
	}
	if e.Rules != nil {
		match := e.Rules.Match(input, evidence)
		if match.Service != "" {
			result.Service = match.Service
			result.Product = match.Product
			result.Version = match.Version
			result.Confidence = max(result.Confidence, match.Confidence)
			if result.Attributes == nil {
				result.Attributes = map[string]string{}
			}
			result.Attributes["rule"] = match.RuleID
		}
	}
	return result
}

func (e *Engine) collect(input Input) (Result, Evidence, error) {
	res, evidence, err := e.Collector.Collect(input)
	if evidence.Passive == nil {
		evidence.Passive = input.PassiveAttrs
	}
	if evidence.HTTP == nil && len(evidence.HTTPs) > 0 {
		first := evidence.HTTPs[0]
		evidence.HTTP = &first
	}
	if len(evidence.HTTPs) == 0 && evidence.HTTP != nil {
		evidence.HTTPs = append(evidence.HTTPs, *evidence.HTTP)
	}
	if err != nil {
		return res, evidence, err
	}
	return res, evidence, nil
}

var errNoCollector = errors.New("fingerprint collector not configured")

func max(a, b int) int {
	if a > b {
		return a
	}
	return b
}

func MergePassive(result *Result, passive map[string]string) {
	if passive == nil {
		return
	}
	if result.Attributes == nil {
		result.Attributes = map[string]string{}
	}
	for k, v := range passive {
		if _, exists := result.Attributes[k]; !exists && v != "" {
			result.Attributes[k] = v
		}
	}
}
