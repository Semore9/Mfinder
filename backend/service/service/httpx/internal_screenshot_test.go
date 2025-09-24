package httpx

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"
)

func TestInternalProcessorOutputsEvenOnError(t *testing.T) {
	proc, err := newInternalScreenshotProcessor(internalScreenshotOptions{
		OutputDir:         t.TempDir(),
		BrowserPath:       "definitely_not_exists.exe",
		Timeout:           500 * time.Millisecond,
		ViewportWidth:     1024,
		ViewportHeight:    768,
		DeviceScaleFactor: 1.0,
		Quality:           90,
		Concurrency:       1,
	})
	if err != nil {
		t.Fatalf("newInternalScreenshotProcessor failed: %v", err)
	}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	in := make(chan outputLine, 1)
	out := proc.Start(ctx, in)

	in <- outputLine{stream: "stdout", text: `{"url":"https://example.com"}`}
	close(in)

	select {
	case result, ok := <-out:
		if !ok {
			t.Fatalf("no output produced")
		}
		if result.stream != "stdout" {
			t.Fatalf("unexpected stream: %s", result.stream)
		}
	case <-time.After(2 * time.Second):
		t.Fatalf("timeout waiting for output")
	}
}

func TestEnrichLinePreservesFields(t *testing.T) {
	proc, err := newInternalScreenshotProcessor(internalScreenshotOptions{
		OutputDir:         t.TempDir(),
		BrowserPath:       "",
		Timeout:           time.Second,
		ViewportWidth:     1024,
		ViewportHeight:    768,
		DeviceScaleFactor: 1.0,
		Quality:           90,
		Concurrency:       1,
	})
	if err != nil {
		t.Fatalf("newInternalScreenshotProcessor failed: %v", err)
	}
	proc.captureOverride = func(ctx context.Context, target string) (string, string, error) {
		return "", "", errors.New("test skip capture")
	}

	raw := `{"input":"http://example.com","host":"example.com","status-code":200,"content-length":1234,"technologies":["nginx"],"ip":"93.184.216.34"}`
	got, err := proc.enrichLine(context.Background(), raw)
	if err == nil {
		t.Fatalf("expected enrichLine to propagate capture error")
	}
	if !strings.Contains(got, "\"status-code\":200") {
		t.Fatalf("status-code field missing: %s", got)
	}
	if !strings.Contains(got, "\"content-length\":1234") {
		t.Fatalf("content-length field missing: %s", got)
	}
	if !strings.Contains(got, "nginx") {
		t.Fatalf("technologies field missing: %s", got)
	}
	if !strings.Contains(got, "93.184.216.34") {
		t.Fatalf("ip field missing: %s", got)
	}
}
