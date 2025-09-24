package fingerprint

import _ "embed"

var (
	//go:embed rules/fingerprinthub_web.json
	embeddedFingerprintHubRules []byte
)

// EmbeddedRuleSet 返回内置的 FingerprintHub 规则集，如解析失败则返回 nil。
func EmbeddedRuleSet() *RuleSet {
	if len(embeddedFingerprintHubRules) == 0 {
		return nil
	}
	rs, err := ParseRuleSet(embeddedFingerprintHubRules)
	if err != nil {
		return nil
	}
	return rs
}
