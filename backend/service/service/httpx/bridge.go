package httpx

import (
	"bufio"
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/google/shlex"
	pkgerrors "github.com/pkg/errors"
	"github.com/yitter/idgenerator-go/idgen"

	"mfinder/backend/application"
	"mfinder/backend/config"
	"mfinder/backend/constant/event"
	"mfinder/backend/constant/status"
	"mfinder/backend/osoperation"
)

type Bridge struct {
	app *application.Application
}

func NewBridge(app *application.Application) *Bridge {
	return &Bridge{app: app}
}

type task struct {
	cmd         *exec.Cmd
	cancel      context.CancelFunc
	tmpFile     string
	start       time.Time
	done        chan struct{}
	lineSeen    atomic.Uint64
	emitterDone chan struct{}
	emitterWait time.Duration
}

func (t *task) linesAdded(n int) {
	if n <= 0 {
		return
	}
	t.lineSeen.Add(uint64(n))
}

type taskManager struct {
	mu    sync.Mutex
	tasks map[int64]*task
}

func newTaskManager() *taskManager {
	return &taskManager{tasks: make(map[int64]*task)}
}

func (m *taskManager) set(id int64, t *task) {
	m.mu.Lock()
	m.tasks[id] = t
	m.mu.Unlock()
}

func (m *taskManager) get(id int64) (*task, bool) {
	m.mu.Lock()
	t, ok := m.tasks[id]
	m.mu.Unlock()
	return t, ok
}

func (m *taskManager) delete(id int64) {
	m.mu.Lock()
	delete(m.tasks, id)
	m.mu.Unlock()
}

var runningTasks = newTaskManager()

func (r *Bridge) Run(path, flags, targets string) (int64, error) {
	path = strings.TrimSpace(path)
	if path == "" {
		return 0, errors.New("未指定 httpx 程序路径")
	}
	if _, err := os.Stat(path); err != nil {
		return 0, pkgerrors.Wrap(err, "httpx 路径无效")
	}
	if strings.TrimSpace(targets) == "" {
		return 0, errors.New("未提供任何目标")
	}

	userArgs, err := parseFlags(flags)
	if err != nil {
		return 0, err
	}
	cfg := r.app.Config.Httpx
	useInternalScreenshot := cfg.Screenshot && strings.EqualFold(strings.TrimSpace(cfg.ScreenshotMode), "internal")
	autoArgs := buildAutoArgs(cfg)
	args := append(autoArgs, userArgs...)
	args = ensureNoColor(args)
	if useInternalScreenshot {
		args = sanitizeArgsForInternal(args)
		args = ensureFlagPresent(args, "-json")
	}

	tmpFile, err := writeTargets(targets)
	if err != nil {
		return 0, err
	}

	var (
		screenshotProcessor *internalScreenshotProcessor
		emitterWait         time.Duration
	)
	if useInternalScreenshot {
		outputDir := strings.TrimSpace(cfg.ScreenshotDirectory)
		if outputDir == "" {
			outputDir = filepath.Join(r.app.AppDir, "screenshot")
		}
		timeout := parseScreenshotTimeout(cfg.ScreenshotTimeout, 15*time.Second)
		processor, err := newInternalScreenshotProcessor(internalScreenshotOptions{
			OutputDir:         outputDir,
			BrowserPath:       strings.TrimSpace(cfg.ScreenshotBrowserPath),
			Timeout:           timeout,
			ViewportWidth:     cfg.ScreenshotViewportWidth,
			ViewportHeight:    cfg.ScreenshotViewportHeight,
			DeviceScaleFactor: cfg.ScreenshotDeviceScaleFactor,
			Quality:           cfg.ScreenshotQuality,
			Concurrency:       cfg.ScreenshotConcurrency,
			Logger:            r.app.Logger.WithField("component", "httpx.internalScreenshot"),
		})
		if err != nil {
			_ = os.Remove(tmpFile)
			return 0, err
		}
		screenshotProcessor = processor
		conc := cfg.ScreenshotConcurrency
		if conc <= 0 {
			conc = 1
		}
		emitterWait = timeout*time.Duration(conc) + 5*time.Second
	}

	args = append(args, "-l", tmpFile)
	r.app.Logger.WithField("httpx.path", path).
		WithField("httpx.args", strings.Join(args, " ")).
		WithField("httpx.targets", len(strings.Split(strings.TrimSpace(targets), "\n"))).
		WithField("httpx.internalScreenshot", useInternalScreenshot).
		Info("httpx task starting")

	ctx, cancel := context.WithCancel(context.Background())
	cmd := exec.CommandContext(ctx, path, args...)
	osoperation.HideCmdWindow(cmd)
	if env := r.buildEnv(); len(env) > 0 {
		cmd.Env = env
	}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		cancel()
		_ = os.Remove(tmpFile)
		return 0, pkgerrors.Wrap(err, "获取 httpx 标准输出失败")
	}
	stderr, err := cmd.StderrPipe()
	if err != nil {
		cancel()
		_ = os.Remove(tmpFile)
		return 0, pkgerrors.Wrap(err, "获取 httpx 标准错误失败")
	}

	if err := cmd.Start(); err != nil {
		cancel()
		_ = os.Remove(tmpFile)
		return 0, pkgerrors.Wrap(err, "启动 httpx 失败")
	}

	taskID := idgen.NextId()
	t := &task{
		cmd:         cmd,
		cancel:      cancel,
		tmpFile:     tmpFile,
		start:       time.Now(),
		done:        make(chan struct{}),
		emitterDone: make(chan struct{}),
		emitterWait: emitterWait,
	}
	runningTasks.set(taskID, t)

	if screenshotProcessor != nil {
		screenshotProcessor.opts.Logger = screenshotProcessor.opts.Logger.WithField("taskID", taskID)
	}

	linesCh := make(chan outputLine, 1024)
	var wg sync.WaitGroup
	wg.Add(2)
	go readStream("stdout", stdout, linesCh, &wg)
	go readStream("stderr", stderr, linesCh, &wg)
	go func() {
		wg.Wait()
		close(linesCh)
	}()

	finalLines := (<-chan outputLine)(linesCh)
	if screenshotProcessor != nil {
		finalLines = screenshotProcessor.Start(ctx, linesCh)
		r.app.Logger.WithField("taskID", taskID).
			WithField("httpx.internalScreenshotDir", screenshotProcessor.opts.OutputDir).
			WithField("httpx.internalScreenshotConcurrency", screenshotProcessor.opts.Concurrency).
			WithField("httpx.internalScreenshotTimeout", screenshotProcessor.opts.Timeout.String()).
			Info("httpx internal screenshot pipeline ready")
	}

	go r.streamEmitter(taskID, t, finalLines)
	go r.waitForExit(taskID, t, ctx)

	return taskID, nil
}

func (r *Bridge) Stop(taskID int64) error {
	if taskID == 0 {
		return errors.New("无效 taskID")
	}
	t, ok := runningTasks.get(taskID)
	if !ok {
		return nil
	}
	select {
	case <-t.done:
		return nil
	default:
	}

	t.cancel()
	select {
	case <-t.done:
		return nil
	case <-time.After(3 * time.Second):
		if err := osoperation.KillProcess(t.cmd); err != nil {
			return pkgerrors.Wrap(err, "终止 httpx 进程失败")
		}
		<-t.done
		return nil
	}
}

func (r *Bridge) SetConfig(path, flags string) error {
	cfg := r.app.Config.Httpx
	cfg.Path = path
	cfg.Flags = flags
	return r.SaveConfig(cfg)
}

func (r *Bridge) SaveConfig(cfg config.Httpx) error {
	r.app.Config.Httpx = cfg
	if err := r.app.WriteConfig(r.app.Config); err != nil {
		r.app.Logger.Error(err)
		return err
	}
	return nil
}

type outputLine struct {
	stream string
	text   string
}

func readStream(stream string, reader io.ReadCloser, out chan<- outputLine, wg *sync.WaitGroup) {
	defer wg.Done()
	defer reader.Close()

	scanner := bufio.NewScanner(reader)
	scanner.Buffer(make([]byte, 0, 64<<10), 1<<20) // 1MB
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" {
			continue
		}
		out <- outputLine{stream: stream, text: line}
	}
	if err := scanner.Err(); err != nil {
		out <- outputLine{stream: "stderr", text: fmt.Sprintf("scanner error: %v", err)}
	}
}

func (r *Bridge) streamEmitter(taskID int64, t *task, lines <-chan outputLine) {
	defer close(t.emitterDone)
	ticker := time.NewTicker(150 * time.Millisecond)
	defer ticker.Stop()
	batch := map[string][]string{}
	flush := func() {
		if len(batch) == 0 {
			return
		}
		for stream, lines := range batch {
			if len(lines) == 0 {
				continue
			}
			t.linesAdded(len(lines))
			event.Emit(event.Httpx, event.EventDetail{
				ID:     taskID,
				Status: status.Running,
				Data: map[string]any{
					"stream": stream,
					"lines":  append([]string(nil), lines...),
				},
			})
			if stream != "stdout" {
				r.app.Logger.WithField("stream", stream).WithField("lines", len(lines)).Info("httpx stream chunk")
			}
		}
		batch = map[string][]string{}
	}

	for {
		select {
		case line, ok := <-lines:
			if !ok {
				flush()
				return
			}
			batch[line.stream] = append(batch[line.stream], line.text)
			if len(batch[line.stream]) >= 200 {
				flush()
			}
		case <-ticker.C:
			flush()
		}
	}
}

func (r *Bridge) waitForExit(taskID int64, t *task, ctx context.Context) {
	defer func() {
		close(t.done)
		runningTasks.delete(taskID)
		if t.tmpFile != "" {
			_ = os.Remove(t.tmpFile)
		}
	}()

	err := t.cmd.Wait()
	state := t.cmd.ProcessState
	exitCode := 0
	if state != nil {
		exitCode = state.ExitCode()
	}
	if t.emitterDone != nil {
		wait := t.emitterWait
		if wait <= 0 {
			<-t.emitterDone
		} else {
			select {
			case <-t.emitterDone:
			case <-time.After(wait):
				r.app.Logger.WithField("taskID", taskID).
					WithField("emitterWait", wait.String()).
					Warn("httpx emitter did not finish within timeout")
			}
		}
	}

	final := map[string]any{
		"exitCode":    exitCode,
		"durationMs":  time.Since(t.start).Milliseconds(),
		"lines":       t.lineSeen.Load(),
		"finishedAt":  time.Now().Format(time.RFC3339Nano),
		"wasCanceled": ctx.Err() == context.Canceled,
	}

	if errors.Is(ctx.Err(), context.Canceled) {
		final["reason"] = "canceled"
		r.app.Logger.WithField("taskID", taskID).Info("httpx task canceled")
		event.Emit(event.Httpx, event.EventDetail{
			ID:     taskID,
			Status: status.Stopped,
			Data:   final,
		})
		return
	}

	if err != nil {
		final["reason"] = err.Error()
		r.app.Logger.WithField("taskID", taskID).
			WithField("exitCode", exitCode).
			WithError(err).
			Error("httpx task failed")
		event.Emit(event.Httpx, event.EventDetail{
			ID:     taskID,
			Status: status.Error,
			Error:  err.Error(),
			Data:   final,
		})
		return
	}

	final["reason"] = "completed"
	r.app.Logger.WithField("taskID", taskID).
		WithField("exitCode", exitCode).
		WithField("lines", final["lines"]).
		Info("httpx task completed")
	event.Emit(event.Httpx, event.EventDetail{
		ID:     taskID,
		Status: status.Stopped,
		Data:   final,
	})
}

func parseFlags(flags string) ([]string, error) {
	flags = strings.TrimSpace(flags)
	if flags == "" {
		return []string{}, nil
	}
	args, err := shlex.Split(flags)
	if err != nil {
		return nil, pkgerrors.Wrap(err, "解析 httpx 参数失败")
	}
	filtered := make([]string, 0, len(args))
	for i := 0; i < len(args); i++ {
		arg := args[i]
		if dropFlag(arg) {
			if expectsValue(arg) && i+1 < len(args) && !strings.HasPrefix(args[i+1], "-") {
				i++
			}
			continue
		}
		filtered = append(filtered, arg)
	}
	return filtered, nil
}

func dropFlag(flag string) bool {
	flag = strings.ToLower(flag)
	if idx := strings.Index(flag, "="); idx > -1 {
		flag = flag[:idx]
	}
	switch flag {
	case "-l", "--list", "-o", "--output", "-resume", "--resume":
		return true
	default:
		return false
	}
}

func expectsValue(flag string) bool {
	flag = strings.ToLower(flag)
	if idx := strings.Index(flag, "="); idx > -1 {
		return false
	}
	switch flag {
	case "-l", "--list", "-o", "--output":
		return true
	default:
		return false
	}
}

func buildAutoArgs(cfg config.Httpx) []string {
	args := make([]string, 0, 16)
	appendFlag := func(enabled bool, flag string) {
		if enabled {
			args = append(args, flag)
		}
	}
	appendFlag(cfg.Silent, "-silent")
	appendFlag(cfg.JSON, "-json")
	appendFlag(cfg.StatusCode, "-sc")
	appendFlag(cfg.Title, "-title")
	appendFlag(cfg.ContentLength, "-cl")
	appendFlag(cfg.TechnologyDetect, "-td")
	appendFlag(cfg.WebServer, "-server")
	appendFlag(cfg.IP, "-ip")
	useInternal := strings.EqualFold(strings.TrimSpace(cfg.ScreenshotMode), "internal")
	if cfg.Screenshot && !useInternal {
		appendFlag(true, "-screenshot")
		appendFlag(cfg.ScreenshotSystemChrome, "-system-chrome")
		if dir := strings.TrimSpace(cfg.ScreenshotDirectory); dir != "" {
			args = append(args, "-srd", dir)
		}
	}
	return args
}

func sanitizeArgsForInternal(args []string) []string {
	if len(args) == 0 {
		return args
	}
	filtered := make([]string, 0, len(args))
	skipNext := false
	for i := 0; i < len(args); i++ {
		if skipNext {
			skipNext = false
			continue
		}
		arg := args[i]
		lower := strings.ToLower(arg)
		switch {
		case strings.HasPrefix(lower, "-screenshot"), strings.HasPrefix(lower, "--screenshot"):
			continue
		case strings.HasPrefix(lower, "-system-chrome"), strings.HasPrefix(lower, "--system-chrome"):
			continue
		case strings.HasPrefix(lower, "-srd"), strings.HasPrefix(lower, "--srd"), strings.HasPrefix(lower, "--screenshot-dir"):
			if !strings.Contains(lower, "=") && i+1 < len(args) && !strings.HasPrefix(args[i+1], "-") {
				skipNext = true
			}
			continue
		default:
			filtered = append(filtered, arg)
		}
	}
	return filtered
}

func ensureFlagPresent(args []string, flag string) []string {
	flagLower := strings.ToLower(flag)
	for _, arg := range args {
		argLower := strings.ToLower(arg)
		if argLower == flagLower || strings.HasPrefix(argLower, flagLower+"=") {
			return args
		}
	}
	return append(args, flag)
}

func ensureNoColor(args []string) []string {
	for _, arg := range args {
		if arg == "-no-color" {
			return args
		}
	}
	return append(args, "-no-color")
}

func parseScreenshotTimeout(raw string, fallback time.Duration) time.Duration {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return fallback
	}
	if duration, err := time.ParseDuration(trimmed); err == nil && duration > 0 {
		return duration
	}
	if seconds, err := strconv.ParseFloat(trimmed, 64); err == nil && seconds > 0 {
		return time.Duration(seconds * float64(time.Second))
	}
	return fallback
}

func writeTargets(targets string) (string, error) {
	file, err := os.CreateTemp("", "httpx-targets-*.txt")
	if err != nil {
		return "", pkgerrors.Wrap(err, "创建临时目标文件失败")
	}
	defer file.Close()
	if _, err := file.WriteString(targets); err != nil {
		_ = os.Remove(file.Name())
		return "", pkgerrors.Wrap(err, "写入临时目标文件失败")
	}
	if err := file.Sync(); err != nil {
		_ = os.Remove(file.Name())
		return "", pkgerrors.Wrap(err, "刷新临时目标文件失败")
	}
	return file.Name(), nil
}

func (r *Bridge) buildEnv() []string {
	cfg := r.app.Config.Httpx
	dir := strings.TrimSpace(cfg.TempDirectory)
	if dir == "" {
		return nil
	}
	absDir, err := filepath.Abs(dir)
	if err != nil {
		r.app.Logger.WithError(err).Warn("httpx temp directory 解析失败")
		return nil
	}
	if err := os.MkdirAll(absDir, 0o755); err != nil {
		r.app.Logger.WithError(err).WithField("dir", absDir).Warn("创建 httpx 临时目录失败")
		return nil
	}
	env := os.Environ()
	env = append(env, "TMP="+absDir, "TEMP="+absDir)
	r.app.Logger.WithField("httpx.tempDir", absDir).Info("httpx 使用自定义临时目录")
	return env
}
