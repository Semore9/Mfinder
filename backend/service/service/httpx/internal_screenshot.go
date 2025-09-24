package httpx

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"math"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"slices"

	"github.com/chromedp/cdproto/network"
	"github.com/chromedp/chromedp"
	pkgerrors "github.com/pkg/errors"
	"github.com/sirupsen/logrus"
	"github.com/yitter/idgenerator-go/idgen"
)

type internalScreenshotOptions struct {
	OutputDir         string
	BrowserPath       string
	Timeout           time.Duration
	ViewportWidth     int
	ViewportHeight    int
	DeviceScaleFactor float64
	Quality           int
	Concurrency       int
	Logger            *logrus.Entry
}

type screenshotJob struct {
	seq  uint64
	line outputLine
}

type screenshotResult struct {
	seq  uint64
	line outputLine
	err  error
}

type internalScreenshotProcessor struct {
	opts            internalScreenshotOptions
	captureOverride func(context.Context, string) (string, string, error)
}

func newInternalScreenshotProcessor(opts internalScreenshotOptions) (*internalScreenshotProcessor, error) {
	if opts.Logger == nil {
		opts.Logger = logrus.New().WithField("component", "httpx.internalScreenshot")
	}
	if opts.Timeout <= 0 {
		opts.Timeout = 15 * time.Second
	}
	if opts.ViewportWidth <= 0 {
		opts.ViewportWidth = 1366
	}
	if opts.ViewportHeight <= 0 {
		opts.ViewportHeight = 768
	}
	if opts.DeviceScaleFactor <= 0 {
		opts.DeviceScaleFactor = 1.0
	}
	if opts.DeviceScaleFactor > 4 {
		opts.DeviceScaleFactor = 4
	}
	if opts.Quality <= 0 || opts.Quality > 100 {
		opts.Quality = 90
	}
	if opts.Concurrency <= 0 {
		opts.Concurrency = 1
	}
	if opts.Concurrency > 8 {
		opts.Concurrency = 8
	}
	absDir, err := filepath.Abs(strings.TrimSpace(opts.OutputDir))
	if err != nil {
		return nil, pkgerrors.Wrap(err, "解析截图目录失败")
	}
	if err := os.MkdirAll(absDir, 0o755); err != nil {
		return nil, pkgerrors.Wrap(err, "创建截图目录失败")
	}
	opts.OutputDir = absDir
	return &internalScreenshotProcessor{opts: opts}, nil
}

func (p *internalScreenshotProcessor) Start(ctx context.Context, in <-chan outputLine) <-chan outputLine {
	out := make(chan outputLine, 1024)
	jobs := make(chan screenshotJob, p.opts.Concurrency*2)
	results := make(chan screenshotResult, p.opts.Concurrency*2)

	var workerWG sync.WaitGroup
	for i := 0; i < p.opts.Concurrency; i++ {
		workerWG.Add(1)
		go p.worker(ctx, jobs, results, &workerWG)
	}

	var seq atomic.Uint64

	go func() {
		defer func() {
			close(jobs)
			workerWG.Wait()
			close(results)
		}()
		for {
			select {
			case <-ctx.Done():
				return
			case line, ok := <-in:
				if !ok {
					return
				}
				currentSeq := seq.Add(1)
				if line.stream == "stdout" {
					job := screenshotJob{seq: currentSeq, line: line}
					select {
					case jobs <- job:
					case <-ctx.Done():
						return
					}
				} else {
					res := screenshotResult{seq: currentSeq, line: line}
					select {
					case results <- res:
					case <-ctx.Done():
						return
					}
				}
			}
		}
	}()

	go func() {
		defer close(out)
		pending := make(map[uint64]screenshotResult)
		nextSeq := uint64(1)
		for {
			select {
			case <-ctx.Done():
				return
			case res, ok := <-results:
				if !ok {
					for {
						r, exists := pending[nextSeq]
						if !exists {
							break
						}
						select {
						case out <- r.line:
						case <-ctx.Done():
							return
						}
						delete(pending, nextSeq)
						nextSeq++
					}
					return
				}
				if res.err != nil {
					p.opts.Logger.WithError(res.err).Warn("httpx internal 截图失败")
				}
				pending[res.seq] = res
				for {
					r, exists := pending[nextSeq]
					if !exists {
						break
					}
					select {
					case out <- r.line:
					case <-ctx.Done():
						return
					}
					delete(pending, nextSeq)
					nextSeq++
				}
			}
		}
	}()

	return out
}

func (p *internalScreenshotProcessor) worker(ctx context.Context, jobs <-chan screenshotJob, results chan<- screenshotResult, wg *sync.WaitGroup) {
	defer wg.Done()
	for {
		select {
		case <-ctx.Done():
			return
		case job, ok := <-jobs:
			if !ok {
				return
			}
			processed := job.line
			updated, err := p.enrichLine(ctx, processed.text)
			if err == nil {
				processed.text = updated
			} else if updated != "" {
				processed.text = updated
			}
			select {
			case results <- screenshotResult{seq: job.seq, line: processed, err: err}:
			case <-ctx.Done():
				return
			}
		}
	}
}

func (p *internalScreenshotProcessor) enrichLine(ctx context.Context, raw string) (string, error) {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" || trimmed[0] != '{' {
		return raw, nil
	}

	decoder := json.NewDecoder(strings.NewReader(trimmed))
	decoder.UseNumber()
	var data map[string]any
	if err := decoder.Decode(&data); err != nil {
		return raw, nil
	}

	candidate := extractURLCandidate(data)
	if candidate == "" {
		if p.opts.Logger != nil {
			p.opts.Logger.WithField("keys", mapKeys(data)).Debug("httpx line skipped: missing url candidate")
		}
		return trimmed, nil
	}

	normalized, err := normalizeURL(candidate)
	if err != nil {
		return raw, err
	}

	if p.opts.Logger != nil {
		missing := missingKeys(data, "status-code", "content-length", "technologies", "ip", "webserver")
		if len(missing) > 0 {
			p.opts.Logger.WithField("target", normalized).
				WithField("missing", missing).
				WithField("keys", mapKeys(data)).
				Debug("httpx json missing expected fields")
		}
	}

	path, encoded, captureErr := p.captureScreenshot(ctx, normalized)
	if captureErr != nil {
		data["internal_screenshot_error"] = captureErr.Error()
		if p.opts.Logger != nil {
			p.opts.Logger.WithField("target", normalized).
				WithField("keys", mapKeys(data)).
				WithField("error", captureErr.Error()).
				Warn("httpx internal 截图失败")
		}
	} else {
		data["screenshot"] = path
		data["screenshot_path"] = path
		data["screenshot_path_rel"] = path
		data["screenshot_bytes"] = encoded
		delete(data, "internal_screenshot_error")
	}

	marshaled, err := json.Marshal(data)
	if err != nil {
		return raw, pkgerrors.Wrap(err, "序列化 httpx 行失败")
	}

	if captureErr != nil {
		return string(marshaled), captureErr
	}
	return string(marshaled), nil
}

func mapKeys(m map[string]any) []string {
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	slices.Sort(keys)
	return keys
}

func missingKeys(m map[string]any, expected ...string) []string {
	missing := make([]string, 0, len(expected))
	for _, key := range expected {
		if hasKeyAlias(m, key) {
			continue
		}
		missing = append(missing, key)
	}
	return missing
}

func hasKeyAlias(m map[string]any, key string) bool {
	if _, ok := m[key]; ok {
		return true
	}
	alternatives := []string{
		strings.ReplaceAll(key, "-", "_"),
		strings.ReplaceAll(key, "_", "-"),
	}
	switch key {
	case "technologies":
		alternatives = append(alternatives, "tech", "technology", "techs")
	case "ip":
		alternatives = append(alternatives, "a", "ip_address", "address")
	case "content-length":
		alternatives = append(alternatives, "contentLength")
	case "status-code":
		alternatives = append(alternatives, "statusCode")
	}
	for _, alt := range alternatives {
		if alt == "" {
			continue
		}
		if value, ok := m[alt]; ok {
			// special handling when alias is array (e.g. "a")
			switch alt {
			case "a":
				if arr, ok := value.([]any); ok && len(arr) == 0 {
					continue
				}
			}
			return true
		}
	}
	return false
}

func extractURLCandidate(data map[string]any) string {
	keys := []string{"url", "final-url", "final_url", "input", "target", "host"}
	for _, key := range keys {
		if value, ok := data[key]; ok {
			if text := toString(value); text != "" {
				return text
			}
		}
	}

	host := toString(data["host"])
	if host == "" {
		return ""
	}
	scheme := toString(data["scheme"])
	if scheme == "" {
		scheme = "http"
	}
	port := toString(data["port"])
	path := toString(data["path"])

	var builder strings.Builder
	builder.WriteString(scheme)
	builder.WriteString("://")
	builder.WriteString(host)
	if port != "" && !strings.Contains(host, ":") {
		builder.WriteString(":")
		builder.WriteString(port)
	}
	if path != "" {
		if !strings.HasPrefix(path, "/") {
			builder.WriteString("/")
		}
		builder.WriteString(path)
	}
	return builder.String()
}

func toString(value any) string {
	switch v := value.(type) {
	case string:
		return strings.TrimSpace(v)
	case json.Number:
		return strings.TrimSpace(v.String())
	case fmt.Stringer:
		return strings.TrimSpace(v.String())
	case float64:
		if math.IsNaN(v) || math.IsInf(v, 0) {
			return ""
		}
		if math.Mod(v, 1) == 0 {
			return strings.TrimSpace(strconv.FormatInt(int64(v), 10))
		}
		return strings.TrimSpace(strconv.FormatFloat(v, 'f', -1, 64))
	case float32:
		fv := float64(v)
		if math.IsNaN(fv) || math.IsInf(fv, 0) {
			return ""
		}
		if math.Mod(fv, 1) == 0 {
			return strings.TrimSpace(strconv.FormatInt(int64(fv), 10))
		}
		return strings.TrimSpace(strconv.FormatFloat(fv, 'f', -1, 32))
	case int, int8, int16, int32, int64:
		return strings.TrimSpace(fmt.Sprintf("%d", v))
	case uint, uint8, uint16, uint32, uint64:
		return strings.TrimSpace(fmt.Sprintf("%d", v))
	case bool:
		if v {
			return "true"
		}
		return "false"
	default:
		return strings.TrimSpace(fmt.Sprint(v))
	}
}

func normalizeURL(raw string) (string, error) {
	candidate := strings.TrimSpace(raw)
	if candidate == "" {
		return "", pkgerrors.New("空的 URL")
	}
	if !strings.Contains(candidate, "://") {
		candidate = "http://" + candidate
	}
	parsed, err := url.Parse(candidate)
	if err != nil {
		return "", err
	}
	if parsed.Scheme == "" {
		parsed.Scheme = "http"
	}
	if parsed.Host == "" {
		if parsed.Path != "" {
			parsed.Host = parsed.Path
			parsed.Path = ""
		} else {
			return "", pkgerrors.New("无效 URL: 缺少 host")
		}
	}
	return parsed.String(), nil
}

func (p *internalScreenshotProcessor) captureScreenshot(ctx context.Context, target string) (string, string, error) {
	if p.captureOverride != nil {
		return p.captureOverride(ctx, target)
	}
	timeoutCtx, cancel := context.WithTimeout(ctx, p.opts.Timeout)
	defer cancel()

	allocOpts := []chromedp.ExecAllocatorOption{
		chromedp.Flag("headless", true),
		chromedp.Flag("disable-gpu", true),
		chromedp.Flag("hide-scrollbars", true),
		chromedp.Flag("mute-audio", true),
		chromedp.Flag("ignore-certificate-errors", true),
		chromedp.WindowSize(p.opts.ViewportWidth, p.opts.ViewportHeight),
	}
	if p.opts.BrowserPath != "" {
		allocOpts = append(allocOpts, chromedp.ExecPath(p.opts.BrowserPath))
	}

	allocCtx, cancelAlloc := chromedp.NewExecAllocator(timeoutCtx, allocOpts...)
	defer cancelAlloc()
	chromeCtx, cancelChrome := chromedp.NewContext(allocCtx)
	defer cancelChrome()

	if err := chromedp.Run(chromeCtx, network.Enable()); err != nil {
		return "", "", pkgerrors.Wrap(err, "启用网络失败")
	}

	emulate := chromedp.EmulateViewport(int64(p.opts.ViewportWidth), int64(p.opts.ViewportHeight), chromedp.EmulateScale(p.opts.DeviceScaleFactor))

	var buf []byte
	actions := chromedp.Tasks{
		emulate,
		chromedp.Navigate(target),
		chromedp.WaitReady("body", chromedp.ByQuery),
		chromedp.Sleep(500 * time.Millisecond),
		chromedp.FullScreenshot(&buf, p.opts.Quality),
	}

	if err := chromedp.Run(chromeCtx, actions); err != nil {
		return "", "", pkgerrors.Wrap(err, "执行截图任务失败")
	}

	filename := fmt.Sprintf("httpx_%d.png", idgen.NextId())
	outputPath := filepath.Join(p.opts.OutputDir, filename)
	if err := os.WriteFile(outputPath, buf, 0o644); err != nil {
		return "", "", pkgerrors.Wrap(err, "写入截图文件失败")
	}

	encoded := base64.StdEncoding.EncodeToString(buf)
	return outputPath, encoded, nil
}
