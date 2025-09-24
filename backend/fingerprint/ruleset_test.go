package fingerprint

import "testing"

func TestMatchHTTPBodyMatcher(t *testing.T) {
	raw := []byte(`[
		{
			"id": "test-body",
			"service": "http",
			"confidence": 50,
			"matchers": [
				{"type": "http_body", "contains": "hello"}
			]
		}
	]`)
	rs, err := ParseRuleSet(raw)
	if err != nil {
		t.Fatalf("ParseRuleSet failed: %v", err)
	}
	match := rs.Match(Input{Port: 80, Scheme: "http"}, Evidence{HTTP: &HTTPInfo{BodySample: "say hello world"}})
	if match.RuleID != "test-body" {
		t.Fatalf("expected rule ID test-body, got %q", match.RuleID)
	}
}

func TestMatchHTTPHeaderAnyMatcher(t *testing.T) {
	raw := []byte(`[
		{
			"id": "test-header",
			"service": "http",
			"confidence": 50,
			"matchers": [
				{"type": "http_header_any", "contains": "nginx", "ignoreCase": true}
			]
		}
	]`)
	rs, err := ParseRuleSet(raw)
	if err != nil {
		t.Fatalf("ParseRuleSet failed: %v", err)
	}
	evidence := Evidence{HTTP: &HTTPInfo{Headers: map[string]string{"server": "nginx/1.20"}}}
	match := rs.Match(Input{Port: 80, Scheme: "http"}, evidence)
	if match.RuleID != "test-header" {
		t.Fatalf("expected rule ID test-header, got %q", match.RuleID)
	}
}

func TestParseRuleSetInvalidRule(t *testing.T) {
	raw := []byte(`[{"id": "", "service": "http", "matchers": []}]`)
	if _, err := ParseRuleSet(raw); err == nil {
		t.Fatalf("expected error for missing id")
	}
}

func TestMatchHTTPBodyMultipleResponses(t *testing.T) {
	raw := []byte(`[
		{
			"id": "test-body-multi",
			"service": "http",
			"confidence": 50,
			"matchers": [
				{"type": "http_body", "pattern": "foo"}
			]
		}
	]`)
	rs, err := ParseRuleSet(raw)
	if err != nil {
		t.Fatalf("ParseRuleSet failed: %v", err)
	}
	ev := Evidence{HTTPs: []HTTPInfo{{BodySample: "bar"}, {BodySample: "foo baz"}}}
	match := rs.Match(Input{Port: 80, Scheme: "http"}, ev)
	if match.RuleID != "test-body-multi" {
		t.Fatalf("expected rule ID test-body-multi, got %q", match.RuleID)
	}
}

func TestMatchHTTPFavicon(t *testing.T) {
	raw := []byte(`[
		{
			"id": "test-favicon",
			"service": "http",
			"confidence": 50,
			"matchers": [
				{"type": "http_favicon", "equals": "12345"}
			]
		}
	]`)
	rs, err := ParseRuleSet(raw)
	if err != nil {
		t.Fatalf("ParseRuleSet failed: %v", err)
	}
	ev := Evidence{FaviconHash: "12345"}
	match := rs.Match(Input{Port: 80, Scheme: "http"}, ev)
	if match.RuleID != "test-favicon" {
		t.Fatalf("expected rule ID test-favicon, got %q", match.RuleID)
	}
}
