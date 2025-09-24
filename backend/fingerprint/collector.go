package fingerprint

import (
	"context"
	"crypto/tls"
	"encoding/base64"
	"errors"
	"io"
	"net"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/twmb/murmur3"
)

const (
	defaultRequestTimeout = 5 * time.Second
	defaultBodyLimit      = 64 * 1024
	defaultFaviconLimit   = 256 * 1024
	defaultUserAgent      = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36"
)

// HTTPCollector 负责执行 HTTP/TLS/Banner 采集。
type HTTPCollector struct {
	Client        *http.Client
	BannerTimeout time.Duration
	TLSConfig     *tls.Config
	Paths         []string
	FetchFavicon  bool
	MaxBodySize   int64
}

func NewHTTPCollector(client *http.Client) *HTTPCollector {
	if client == nil {
		client = &http.Client{Timeout: 4 * time.Second}
	} else if client.Timeout == 0 {
		client.Timeout = 4 * time.Second
	}
	return &HTTPCollector{
		Client:        client,
		BannerTimeout: 2 * time.Second,
		TLSConfig:     &tls.Config{InsecureSkipVerify: true},
		Paths:         []string{"/"},
		FetchFavicon:  true,
		MaxBodySize:   defaultBodyLimit,
	}
}

func (c *HTTPCollector) Collect(input Input) (Result, Evidence, error) {
	start := time.Now()
	evidence := Evidence{Passive: input.PassiveAttrs}

	scheme := input.Scheme
	if scheme == "" {
		if input.Port == 443 || input.Port == 8443 {
			scheme = "https"
		} else {
			scheme = "http"
		}
	}

	host := input.Host
	if host == "" {
		host = input.IP
	}
	if host == "" {
		return Result{Error: errors.New("empty host")}, evidence, nil
	}

	baseURL := scheme + "://" + net.JoinHostPort(host, strconv.Itoa(input.Port))
	paths := c.pathsForInput(input)
	client := c.clientFor(host, scheme)

	ctx := context.Background()
	infos := make([]HTTPInfo, 0, len(paths))
	var lastErr error

	for _, p := range paths {
		info, tlsInfo, err := c.fetchPath(ctx, client, baseURL, p)
		if err != nil {
			lastErr = err
			break
		}
		if evidence.TLS == nil && tlsInfo != nil {
			evidence.TLS = tlsInfo
		}
		infos = append(infos, *info)
	}

	if len(infos) > 0 {
		evidence.HTTP = &infos[0]
		evidence.HTTPs = infos
	}

	fetchFav := c.FetchFavicon
	if input.Hints != nil {
		if v, ok := input.Hints["http.fetchFavicon"]; ok && strings.EqualFold(v, "false") {
			fetchFav = false
		}
	}

	if fetchFav && len(infos) > 0 && shouldFetchFavicon(infos[0]) {
		if hash, err := c.fetchFavicon(ctx, client, baseURL); err == nil && hash != "" {
			evidence.FaviconHash = hash
		}
	}

	result := Result{
		Confidence: 20,
		Source:     "active-http",
		Attributes: map[string]string{},
		Duration:   time.Since(start),
	}

	if evidence.HTTP != nil {
		httpInfo := evidence.HTTP
		if httpInfo.Server != "" {
			result.Service = splitServer(httpInfo.Server)
			result.Attributes["server"] = httpInfo.Server
		}
		if httpInfo.Title != "" {
			result.Attributes["title"] = httpInfo.Title
		}
		if httpInfo.URL != "" {
			result.Attributes["url"] = httpInfo.URL
		}
		if httpInfo.Path != "" {
			result.Attributes["path"] = httpInfo.Path
		}
	} else if lastErr != nil {
		return Result{Duration: time.Since(start), Error: lastErr}, evidence, nil
	}

	if evidence.FaviconHash != "" {
		result.Attributes["favicon_hash"] = evidence.FaviconHash
	}

	return result, evidence, nil
}

func (c *HTTPCollector) pathsForInput(input Input) []string {
	unique := make(map[string]struct{})
	ordered := make([]string, 0, 1+len(c.Paths))
	appendPath := func(items []string) {
		for _, raw := range items {
			p := normalizePath(raw)
			if p == "" {
				continue
			}
			if _, exists := unique[p]; exists {
				continue
			}
			unique[p] = struct{}{}
			ordered = append(ordered, p)
		}
	}

	appendPath(c.Paths)
	hint := ""
	if input.Hints != nil {
		hint = input.Hints["http.paths"]
	}
	if hint != "" {
		appendPath(strings.Split(hint, ","))
	}
	if len(ordered) == 0 {
		ordered = append(ordered, "/")
	}
	return ordered
}

func normalizePath(raw string) string {
	p := strings.TrimSpace(raw)
	if p == "" {
		return ""
	}
	p = strings.ReplaceAll(p, "{{BaseURL}}", "")
	if strings.HasPrefix(p, "http://") || strings.HasPrefix(p, "https://") {
		return p
	}
	if !strings.HasPrefix(p, "/") {
		p = "/" + p
	}
	return p
}

func (c *HTTPCollector) clientFor(host, scheme string) *http.Client {
	client := c.Client
	if client == nil {
		client = &http.Client{Timeout: 4 * time.Second}
	}
	if scheme != "https" {
		return client
	}
	transport := http.DefaultTransport.(*http.Transport).Clone()
	if c.TLSConfig != nil {
		transport.TLSClientConfig = c.TLSConfig.Clone()
	} else {
		transport.TLSClientConfig = &tls.Config{InsecureSkipVerify: true}
	}
	transport.TLSClientConfig.ServerName = host
	return &http.Client{
		Timeout:   client.Timeout,
		Transport: transport,
	}
}

func (c *HTTPCollector) requestTimeout() time.Duration {
	if c.Client != nil && c.Client.Timeout > 0 {
		return c.Client.Timeout
	}
	return defaultRequestTimeout
}

func (c *HTTPCollector) bodyLimit() int64 {
	if c.MaxBodySize > 0 {
		return c.MaxBodySize
	}
	return defaultBodyLimit
}

func (c *HTTPCollector) fetchPath(ctx context.Context, client *http.Client, baseURL, path string) (*HTTPInfo, *TLSInfo, error) {
	reqURL := path
	if !strings.HasPrefix(path, "http://") && !strings.HasPrefix(path, "https://") {
		if path == "/" {
			reqURL = baseURL + "/"
		} else {
			reqURL = baseURL + path
		}
	}
	reqCtx, cancel := context.WithTimeout(ctx, c.requestTimeout())
	defer cancel()

	req, err := http.NewRequestWithContext(reqCtx, http.MethodGet, reqURL, nil)
	if err != nil {
		return nil, nil, err
	}
	req.Header.Set("User-Agent", defaultUserAgent)
	req.Header.Set("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8")

	resp, err := client.Do(req)
	if err != nil {
		return nil, nil, err
	}
	defer resp.Body.Close()

	info := &HTTPInfo{
		Status:  resp.StatusCode,
		Headers: make(map[string]string),
		URL:     reqURL,
		Path:    path,
	}
	for k, v := range resp.Header {
		info.Headers[strings.ToLower(k)] = strings.Join(v, ",")
	}

	body, err := io.ReadAll(io.LimitReader(resp.Body, c.bodyLimit()))
	if err != nil {
		return nil, nil, err
	}
	if len(body) > 0 {
		snippet := string(body)
		info.BodySample = snippet
		if title := extractHTMLTitle(snippet); title != "" {
			info.Title = title
		}
	}
	info.Server = resp.Header.Get("Server")

	var tlsInfo *TLSInfo
	if resp.TLS != nil && len(resp.TLS.PeerCertificates) > 0 {
		cert := resp.TLS.PeerCertificates[0]
		tlsInfo = &TLSInfo{
			Version:     tlsVersionToString(resp.TLS.Version),
			CipherSuite: tls.CipherSuiteName(resp.TLS.CipherSuite),
			CertIssuer:  cert.Issuer.String(),
			CertSubject: cert.Subject.String(),
		}
		tlsInfo.SANs = append(tlsInfo.SANs, cert.DNSNames...)
	}

	return info, tlsInfo, nil
}

func (c *HTTPCollector) fetchFavicon(ctx context.Context, client *http.Client, baseURL string) (string, error) {
	faviconURL := strings.TrimRight(baseURL, "/") + "/favicon.ico"
	reqCtx, cancel := context.WithTimeout(ctx, c.requestTimeout())
	defer cancel()

	req, err := http.NewRequestWithContext(reqCtx, http.MethodGet, faviconURL, nil)
	if err != nil {
		return "", err
	}
	req.Header.Set("User-Agent", defaultUserAgent)
	req.Header.Set("Accept", "image/*;q=0.8, */*;q=0.5")

	resp, err := client.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 400 {
		return "", nil
	}
	data, err := io.ReadAll(io.LimitReader(resp.Body, defaultFaviconLimit))
	if err != nil || len(data) == 0 {
		return "", err
	}
	b64 := base64.StdEncoding.EncodeToString(data)
	hash := int32(murmur3.Sum32([]byte(b64)))
	return strconv.FormatInt(int64(hash), 10), nil
}

func shouldFetchFavicon(info HTTPInfo) bool {
	if info.Status == 0 {
		return false
	}
	if info.Status >= 500 {
		return false
	}
	if info.Status >= 400 && info.Status != 401 && info.Status != 403 {
		return false
	}
	if ct := info.Headers["content-type"]; ct != "" {
		ct = strings.ToLower(ct)
		if strings.Contains(ct, "text") || strings.Contains(ct, "json") || strings.Contains(ct, "xml") || strings.Contains(ct, "html") {
			return true
		}
		return false
	}
	return true
}

func extractHTMLTitle(body string) string {
	lower := strings.ToLower(body)
	start := strings.Index(lower, "<title")
	if start == -1 {
		return ""
	}
	start = strings.Index(lower[start:], ">")
	if start == -1 {
		return ""
	}
	start = start + 1
	end := strings.Index(lower[start:], "</title>")
	if end == -1 {
		return ""
	}
	title := body[start : start+end]
	return strings.TrimSpace(title)
}

func splitServer(server string) string {
	if server == "" {
		return ""
	}
	parts := strings.Fields(server)
	if len(parts) > 0 {
		return strings.ToLower(parts[0])
	}
	return ""
}

func tlsVersionToString(v uint16) string {
	switch v {
	case tls.VersionTLS13:
		return "tls13"
	case tls.VersionTLS12:
		return "tls12"
	case tls.VersionTLS11:
		return "tls11"
	case tls.VersionTLS10:
		return "tls10"
	default:
		return "unknown"
	}
}
