package fingerprint

func DefaultRuleSet() *RuleSet {
	fallback := []Rule{
		{
			ID:         "http-apache",
			Service:    "http",
			Product:    "apache",
			Confidence: 60,
			Ports:      []int{80, 443, 8080, 8443},
			Matchers: []MatcherConfig{
				{Type: "http_header", Key: "server", Contains: "Apache", IgnoreCase: true},
			},
			Tags: []string{"web"},
		},
		{
			ID:         "http-nginx",
			Service:    "http",
			Product:    "nginx",
			Confidence: 60,
			Ports:      []int{80, 443, 8080, 8443},
			Matchers: []MatcherConfig{
				{Type: "http_header", Key: "server", Contains: "nginx", IgnoreCase: true},
			},
			Tags: []string{"web"},
		},
		{
			ID:         "tls-cert-cn",
			Service:    "https",
			Confidence: 40,
			Ports:      []int{443, 8443},
			Matchers: []MatcherConfig{
				{Type: "tls_subject", Contains: "CN=", IgnoreCase: true},
			},
			Tags: []string{"tls"},
		},
	}

	rs := EmbeddedRuleSet()
	if rs == nil {
		compiled, err := compileRules(fallback)
		if err != nil {
			return &RuleSet{}
		}
		return compiled
	}

	for _, rule := range fallback {
		compiled, err := compileRule(rule)
		if err != nil {
			continue
		}
		rs.rules = append(rs.rules, compiled)
	}
	return rs
}
