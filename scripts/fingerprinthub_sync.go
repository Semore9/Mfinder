//go:build ignore

package main

import (
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"runtime"
	"sort"
	"strings"
	"time"
)

const (
	defaultRepoURL = "https://github.com/0x727/FingerprintHub.git"
	defaultBranch  = "main"
)

type fhFingerprint struct {
	ID   string   `json:"id"`
	Info fhInfo   `json:"info"`
	HTTP []fhHTTP `json:"http"`
}

type fhInfo struct {
	Name     string         `json:"name"`
	Author   string         `json:"author"`
	Tags     string         `json:"tags"`
	Severity string         `json:"severity"`
	Metadata map[string]any `json:"metadata"`
}

type fhHTTP struct {
	Method   string      `json:"method"`
	Path     []string    `json:"path"`
	Matchers []fhMatcher `json:"matchers"`
}

type fhMatcher struct {
	Type            string   `json:"type"`
	Words           []string `json:"words"`
	Regex           []string `json:"regex"`
	Hash            []string `json:"hash"`
	CaseInsensitive bool     `json:"case-insensitive"`
	Part            string   `json:"part"`
	Condition       string   `json:"condition"`
}

type outRule struct {
	ID         string       `json:"id"`
	Service    string       `json:"service"`
	Product    string       `json:"product"`
	Version    string       `json:"version"`
	Confidence int          `json:"confidence"`
	Ports      []int        `json:"ports,omitempty"`
	Protocols  []string     `json:"protocols,omitempty"`
	Matchers   []outMatcher `json:"matchers"`
	Tags       []string     `json:"tags,omitempty"`
}

type outMatcher struct {
	Type       string `json:"type"`
	Key        string `json:"key,omitempty"`
	Pattern    string `json:"pattern,omitempty"`
	Contains   string `json:"contains,omitempty"`
	Equals     string `json:"equals,omitempty"`
	IgnoreCase bool   `json:"ignoreCase,omitempty"`
}

type metadata struct {
	SourceRepo string         `json:"sourceRepo"`
	Branch     string         `json:"branch"`
	Commit     string         `json:"commit"`
	Generated  string         `json:"generatedAt"`
	RulesTotal int            `json:"rulesTotal"`
	Skipped    map[string]int `json:"skipped"`
}

func main() {
	repoURL := flag.String("repo", defaultRepoURL, "FingerprintHub 仓库地址")
	branch := flag.String("branch", defaultBranch, "分支名称")
	mirror := flag.String("mirror", "", "可选：用于克隆的镜像仓库地址")
	cacheDir := flag.String("cache", filepath.Join("scripts", ".cache", "fingerprinthub"), "缓存目录")
	outputRules := flag.String("out", filepath.Join("backend", "fingerprint", "rules", "fingerprinthub_web.json"), "输出规则文件")
	outputMeta := flag.String("meta", filepath.Join("backend", "fingerprint", "rules", "fingerprinthub_web.meta.json"), "输出元信息文件")
	minConfidence := flag.Int("confidence", 70, "转换规则默认置信度 (verified 时自动+10)")
	flag.Parse()

	if runtime.GOOS == "windows" {
		fmt.Println("[fingerprinthub] Windows 平台跳过自动同步，使用仓库中预生成规则。")
		if _, err := os.Stat(*outputRules); err != nil {
			fmt.Fprintf(os.Stderr, "[error] 预生成规则不存在: %v\n", err)
			os.Exit(1)
		}
		return
	}

	repoDir := filepath.Join(*cacheDir, "FingerprintHub")
	urlToUse := selectURL(*repoURL, *mirror)
	if err := ensureRepo(repoDir, urlToUse, *branch); err != nil {
		fmt.Fprintf(os.Stderr, "[error] 同步仓库失败: %v\n", err)
		os.Exit(1)
	}

	commit, err := gitOutput(repoDir, "rev-parse", "HEAD")
	if err != nil {
		fmt.Fprintf(os.Stderr, "[error] 获取 commit 失败: %v\n", err)
		os.Exit(1)
	}
	commit = strings.TrimSpace(commit)

	rulesPath := filepath.Join(repoDir, "web_fingerprint_v4.json")
	data, err := os.ReadFile(rulesPath)
	if err != nil {
		fmt.Fprintf(os.Stderr, "[error] 读取 web_fingerprint_v4.json 失败: %v\n", err)
		os.Exit(1)
	}

	var fingerprints []fhFingerprint
	if err := json.Unmarshal(data, &fingerprints); err != nil {
		fmt.Fprintf(os.Stderr, "[error] 解析 JSON 失败: %v\n", err)
		os.Exit(1)
	}

	converted, skips := convertFingerprints(fingerprints, *minConfidence)
	sort.Slice(converted, func(i, j int) bool { return converted[i].ID < converted[j].ID })

	if len(converted) == 0 {
		fmt.Fprintln(os.Stderr, "[error] 转换结果为空，终止")
		os.Exit(1)
	}

	if err := os.MkdirAll(filepath.Dir(*outputRules), 0o755); err != nil {
		fmt.Fprintf(os.Stderr, "[error] 创建输出目录失败: %v\n", err)
		os.Exit(1)
	}
	if err := writeJSON(*outputRules, converted); err != nil {
		fmt.Fprintf(os.Stderr, "[error] 写入规则失败: %v\n", err)
		os.Exit(1)
	}

	meta := metadata{
		SourceRepo: urlToUse,
		Branch:     *branch,
		Commit:     commit,
		Generated:  time.Now().UTC().Format(time.RFC3339),
		RulesTotal: len(converted),
		Skipped:    skips,
	}
	if err := writeJSON(*outputMeta, meta); err != nil {
		fmt.Fprintf(os.Stderr, "[error] 写入元信息失败: %v\n", err)
		os.Exit(1)
	}

	fmt.Printf("完成，转换规则 %d 条，跳过 %d 条\n", len(converted), totalSkipped(skips))
}

func selectURL(primary, mirror string) string {
	if mirror != "" {
		return mirror
	}
	return primary
}

func ensureRepo(repoDir, repoURL, branch string) error {
	if _, err := os.Stat(filepath.Join(repoDir, ".git")); errors.Is(err, os.ErrNotExist) {
		if err := os.MkdirAll(filepath.Dir(repoDir), 0o755); err != nil {
			return err
		}
		args := []string{"clone", "--depth", "1", "--branch", branch, repoURL, repoDir}
		if err := runGit("", args...); err != nil {
			return fmt.Errorf("git clone: %w", err)
		}
		return nil
	}
	if err := runGit(repoDir, "fetch", "origin", branch); err != nil {
		return fmt.Errorf("git fetch: %w", err)
	}
	if err := runGit(repoDir, "checkout", branch); err != nil {
		return fmt.Errorf("git checkout: %w", err)
	}
	if err := runGit(repoDir, "reset", "--hard", "origin/"+branch); err != nil {
		return fmt.Errorf("git reset: %w", err)
	}
	return nil
}

func runGit(dir string, args ...string) error {
	cmd := exec.Command("git", args...)
	if dir != "" {
		cmd.Dir = dir
	}
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	return cmd.Run()
}

func gitOutput(dir string, args ...string) (string, error) {
	cmd := exec.Command("git", args...)
	cmd.Dir = dir
	cmd.Stderr = os.Stderr
	out, err := cmd.Output()
	if err != nil {
		return "", err
	}
	return string(out), nil
}

func convertFingerprints(list []fhFingerprint, baseConfidence int) ([]outRule, map[string]int) {
	result := make([]outRule, 0, len(list))
	skips := map[string]int{}

	for _, fp := range list {
		rule, reason := convertSingle(fp, baseConfidence)
		if reason != "" {
			skips[reason]++
			continue
		}
		result = append(result, rule)
	}
	return result, skips
}

func convertSingle(fp fhFingerprint, baseConfidence int) (outRule, string) {
	if fp.ID == "" {
		return outRule{}, "missing_id"
	}
	httpReq, ok := pickHTTPRequest(fp.HTTP)
	if !ok {
		return outRule{}, "no_supported_request"
	}

	matchers := make([]outMatcher, 0)
	for _, m := range httpReq.Matchers {
		converted, ok := convertMatcher(m)
		if !ok {
			continue
		}
		matchers = append(matchers, converted...)
	}
	if len(matchers) == 0 {
		return outRule{}, "empty_matchers"
	}

	product := strings.TrimSpace(valueFromMetadata(fp.Info.Metadata, "product"))
	if product == "" {
		product = strings.TrimSpace(fp.Info.Name)
	}

	tags := splitAndTrim(fp.Info.Tags)
	confidence := baseConfidence
	if isVerified(fp.Info.Metadata) {
		confidence += 10
	}

	rule := outRule{
		ID:         fp.ID,
		Service:    "http",
		Product:    product,
		Version:    "",
		Confidence: clamp(confidence, 10, 100),
		Ports:      []int{80, 443, 8080, 8443},
		Protocols:  []string{"http", "https"},
		Matchers:   matchers,
		Tags:       tags,
	}
	return rule, ""
}

func pickHTTPRequest(list []fhHTTP) (fhHTTP, bool) {
	for _, item := range list {
		if !strings.EqualFold(item.Method, "GET") {
			continue
		}
		if len(item.Path) == 0 {
			continue
		}
		for _, p := range item.Path {
			if strings.Contains(p, "{{BaseURL}}") {
				return item, true
			}
		}
	}
	return fhHTTP{}, false
}

func convertMatcher(m fhMatcher) ([]outMatcher, bool) {
	t := strings.ToLower(m.Type)
	switch t {
	case "word":
		return convertWordMatcher(m)
	case "regex":
		return convertRegexMatcher(m)
	case "favicon":
		return convertFaviconMatcher(m)
	default:
		return nil, false
	}
}

func convertWordMatcher(m fhMatcher) ([]outMatcher, bool) {
	if len(m.Words) == 0 {
		return nil, false
	}
	targetType := targetTypeForPart(m.Part)
	if targetType == "" {
		return nil, false
	}
	condition := strings.ToLower(m.Condition)
	if condition == "" {
		condition = "or"
	}
	if condition == "or" {
		escaped := escapeRegexList(m.Words)
		if len(escaped) == 0 {
			return nil, false
		}
		pattern := strings.Join(escaped, "|")
		return []outMatcher{buildRegexMatcher(targetType, "", pattern, m.CaseInsensitive)}, true
	}

	out := make([]outMatcher, 0, len(m.Words))
	for _, word := range m.Words {
		word = strings.TrimSpace(word)
		if word == "" {
			continue
		}
		out = append(out, outMatcher{Type: targetType, Contains: word, IgnoreCase: m.CaseInsensitive})
	}
	if len(out) == 0 {
		return nil, false
	}
	return out, true
}

func convertRegexMatcher(m fhMatcher) ([]outMatcher, bool) {
	if len(m.Regex) == 0 {
		return nil, false
	}
	targetType := targetTypeForPart(m.Part)
	if targetType == "" {
		return nil, false
	}
	patterns := make([]outMatcher, 0, len(m.Regex))
	for _, raw := range m.Regex {
		raw = strings.TrimSpace(raw)
		if raw == "" {
			continue
		}
		if _, err := regexp.Compile(raw); err != nil {
			return nil, false
		}
		patterns = append(patterns, buildRegexMatcher(targetType, "", raw, false))
	}
	if len(patterns) == 0 {
		return nil, false
	}
	return patterns, true
}

func convertFaviconMatcher(m fhMatcher) ([]outMatcher, bool) {
	if len(m.Hash) == 0 {
		return nil, false
	}
	out := make([]outMatcher, 0, len(m.Hash))
	for _, h := range m.Hash {
		h = strings.TrimSpace(h)
		if h == "" {
			continue
		}
		out = append(out, outMatcher{Type: "http_favicon", Equals: h})
	}
	if len(out) == 0 {
		return nil, false
	}
	return out, true
}

func targetTypeForPart(part string) string {
	switch strings.ToLower(part) {
	case "", "body", "response", "body_256", "body_512", "body_1024":
		return "http_body"
	case "header", "all_headers":
		return "http_header_any"
	case "title":
		return "http_title"
	default:
		return ""
	}
}

func buildRegexMatcher(t, key, pattern string, ignoreCase bool) outMatcher {
	if ignoreCase && !strings.HasPrefix(pattern, "(?i)") {
		pattern = "(?i)(" + pattern + ")"
	}
	return outMatcher{Type: t, Key: key, Pattern: pattern}
}

func escapeRegexList(items []string) []string {
	out := make([]string, 0, len(items))
	for _, v := range items {
		v = strings.TrimSpace(v)
		if v == "" {
			continue
		}
		out = append(out, regexp.QuoteMeta(v))
	}
	return out
}

func splitAndTrim(value string) []string {
	if value == "" {
		return nil
	}
	parts := strings.Split(value, ",")
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		p = strings.TrimSpace(p)
		if p != "" {
			out = append(out, p)
		}
	}
	return out
}

func valueFromMetadata(meta map[string]any, key string) string {
	if meta == nil {
		return ""
	}
	if raw, ok := meta[key]; ok {
		switch v := raw.(type) {
		case string:
			return v
		}
	}
	return ""
}

func isVerified(meta map[string]any) bool {
	if meta == nil {
		return false
	}
	if raw, ok := meta["verified"]; ok {
		switch v := raw.(type) {
		case bool:
			return v
		case string:
			return strings.EqualFold(v, "true")
		}
	}
	return false
}

func clamp(v, min, max int) int {
	if v < min {
		return min
	}
	if v > max {
		return max
	}
	return v
}

func writeJSON(path string, value any) error {
	data, err := json.MarshalIndent(value, "", "  ")
	if err != nil {
		return err
	}
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, data, 0o644); err != nil {
		return err
	}
	return os.Rename(tmp, path)
}

func totalSkipped(m map[string]int) int {
	total := 0
	for _, v := range m {
		total += v
	}
	return total
}
