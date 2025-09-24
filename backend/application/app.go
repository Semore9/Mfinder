package application

import (
	"context"
	"fmt"
	"io"
	"mfinder/backend/config"
	"mfinder/backend/constant/event"
	"mfinder/backend/constant/history"
	"mfinder/backend/constant/status"
	"mfinder/backend/database"
	"mfinder/backend/database/models"
	"mfinder/backend/database/repository"
	"mfinder/backend/logger"
	"mfinder/backend/matcher"
	"mfinder/backend/utils"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"time"

	"github.com/fasnow/goproxy"
	"github.com/hashicorp/go-version"
	"github.com/pkg/errors"
	"github.com/sirupsen/logrus"
	"github.com/yitter/idgenerator-go/idgen"
	"gopkg.in/ini.v1"
	"gopkg.in/yaml.v3"
)

const Version = "2.4.3"

func init() {
	ini.PrettyFormat = false
	// 创建 IdGeneratorOptions 对象，可在构造函数中输入 WorkerId：
	var idgenOpts = idgen.NewIdGeneratorOptions(1)
	// options.WorkerIdBitLength = 10  // 默认值6，限定 WorkerId 最大值为2^6-1，即默认最多支持64个节点。
	// options.SeqBitLength = 6; // 默认值6，限制每毫秒生成的ID个数。若生成速度超过5万个/秒，建议加大 SeqBitLength 到 10。
	// options.BaseTime = Your_Base_Time // 如果要兼容老系统的雪花算法，此处应设置为老系统的BaseTime。
	// ...... 其它参数参考 IdGeneratorOptions 定义。
	// 保存参数（务必调用，否则参数设置不生效）：
	idgen.SetIdGenerator(idgenOpts)
}

var iniOptions = ini.LoadOptions{
	SkipUnrecognizableLines:  true, //跳过无法识别的行
	SpaceBeforeInlineComment: true,
	AllowShadows:             true,
}

var defaultConfig = &config.Config{
	Version: Version,
	Timeout: 20 * time.Second,
	Proxy: config.Proxy{
		Enable: false,
		Type:   "http",
		Host:   "127.0.0.1",
		Port:   "8080",
		User:   "",
		Pass:   "",
	},
	Fofa: config.Fofa{
		Interval: 300 * time.Millisecond,
	},
	Hunter: config.Hunter{
		Interval: 1500 * time.Millisecond,
	},
	Quake: config.Quake{
		Interval: 1 * time.Second,
	},
	Zone: config.Zone{
		Interval: 1 * time.Second,
	},
	ICP: config.ICP{
		Timeout: 10 * time.Second,
		Proxy: config.Proxy{
			Enable: false,
			Type:   "http",
			Host:   "127.0.0.1",
			Port:   "8080",
			User:   "",
			Pass:   "",
		},
		AuthErrorRetryNum1:      3,
		ForbiddenErrorRetryNum1: 1,
		AuthErrorRetryNum2:      999,
		ForbiddenErrorRetryNum2: 999,
		Concurrency:             5,
	},
	Shodan: config.Shodan{
		Interval: 1 * time.Second,
	},
	TianYanCha: config.TianYanCha{Token: ""},
	AiQiCha:    config.AiQiCha{Cookie: ""},
	Httpx: config.Httpx{
		Path:                        "",
		Flags:                       "",
		Silent:                      true,
		JSON:                        true,
		StatusCode:                  true,
		Title:                       true,
		ContentLength:               true,
		TechnologyDetect:            true,
		WebServer:                   true,
		IP:                          true,
		Screenshot:                  false,
		ScreenshotSystemChrome:      false,
		ScreenshotDirectory:         "",
		TempDirectory:               "",
		ScreenshotMode:              "external",
		ScreenshotBrowserPath:       "",
		ScreenshotTimeout:           "15s",
		ScreenshotViewportWidth:     1366,
		ScreenshotViewportHeight:    768,
		ScreenshotDeviceScaleFactor: 1.0,
		ScreenshotQuality:           90,
		ScreenshotConcurrency:       2,
	},
	Gogo: config.Gogo{
		Ports:      "top1",
		Mode:       "default",
		Threads:    0,
		Delay:      2 * time.Second,
		HTTPSDelay: 2 * time.Second,
		Exploit:    "none",
		Verbose:    0,
	},
	Wechat: config.Wechat{
		Rules:                DefaultRegex,
		DecompileConcurrency: 5,
		ExtractConcurrency:   runtime.NumCPU() * 3,
	},
}

var DefaultApp = NewApp()

type Application struct {
	ctx          context.Context
	Config       *config.Config
	ConfigFile   string
	AppDir       string
	http         *http.Client
	ProxyManager *goproxy.GoProxy
	Logger       *logrus.Logger
	UserHome     string

	proxyHistoryRepo repository.ProxyHistoryRepository
}

func NewApp() *Application {
	app := &Application{
		Config:       &config.Config{},
		ProxyManager: goproxy.New(),
	}
	app.ProxyManager.AutoSetUserAgent(true)
	// Ensure the proxy manager always has a valid transport even when no proxy is configured.
	_ = app.ProxyManager.SetProxy("")
	app.init()
	app.UseProxyManager(app.ProxyManager)
	database.SetDatabaseFile(app.Config.DatabaseFile)
	app.proxyHistoryRepo = repository.NewProxyHistoryRepository(database.GetConnection())
	return app
}

func (r *Application) init() {
	r.AppDir = filepath.Dir(os.Args[0])
	if runtime.GOOS != "windows" {
		// 如果无法获取家目录则调用操作系统弹窗提示
		if t, err := os.UserHomeDir(); err != nil {
			ShowErrorMessage(err.Error())
			os.Exit(1)
		} else {
			r.UserHome = t
			r.AppDir = filepath.Join(r.UserHome, "fine")
		}
	}
	r.ConfigFile = filepath.Join(r.AppDir, "config.yaml")
	if utils.FileExist(r.ConfigFile) {
		if err := r.loadConfigFile(); err != nil {
			ShowErrorMessage(err.Error())
			os.Exit(1)
		}
	} else {
		if err := r.generateConfigFile(); err != nil {
			ShowErrorMessage(err.Error())
			os.Exit(1)
		}
	}
}

func (r *Application) transformConfigFile() error {
	cfg, err := ini.LoadSources(iniOptions, r.ConfigFile)
	if err != nil {
		msg := "can't open config file:" + err.Error()
		return errors.New(msg)
	}
	if err = cfg.MapTo(r.Config); err != nil {
		msg := "can't map to config file:" + err.Error()
		return errors.New(msg)
	}
	r.Config.Wechat.Rules = DefaultRegex // 丢弃以前的规则
	r.ConfigFile = filepath.Join(r.AppDir, "config.yaml")
	if err := r.WriteConfig(r.Config); err != nil {
		return err
	}
	r.Logger = logger.NewWithLogDir(r.Config.LogDataDir)

	if err := os.Remove(filepath.Join(r.AppDir, "config.ini")); err != nil {
		r.Logger.Error(err)
	}
	return r.loadConfigFile()
}

func (r *Application) loadConfigFile() error {
	readData, err := os.ReadFile(r.ConfigFile)
	if err != nil {
		return err
	}
	if err := yaml.Unmarshal(readData, r.Config); err != nil {
		return err
	}
	var needUpdate = false
	if r.Config.LogDataDir == "" {
		r.Config.LogDataDir = filepath.Join(r.AppDir, "data", "log")
		needUpdate = true
	}
	if r.Config.DatabaseFile == "" {
		r.Config.DatabaseFile = filepath.Join(r.AppDir, "data", "data.db")
		needUpdate = true
	}
	r.Logger = logger.NewWithLogDir(r.Config.LogDataDir)
	if r.Config.ExportDataDir == "" {
		r.Config.ExportDataDir = filepath.Join(r.AppDir, "data", "export")
		needUpdate = true
	}
	if r.Config.WechatDataDir == "" {
		r.Config.WechatDataDir = filepath.Join(r.AppDir, "data", "wechat")
		needUpdate = true
	}
	if r.Config.ICP.AuthErrorRetryNum1 <= 0 {
		r.Config.ICP.AuthErrorRetryNum1 = 3
		needUpdate = true
	}
	if r.Config.ICP.ForbiddenErrorRetryNum1 <= 0 {
		r.Config.ICP.ForbiddenErrorRetryNum1 = 1
		needUpdate = true
	}
	if r.Config.ICP.AuthErrorRetryNum2 <= 0 {
		r.Config.ICP.AuthErrorRetryNum2 = 999
		needUpdate = true
	}
	if r.Config.ICP.ForbiddenErrorRetryNum2 <= 0 {
		r.Config.ICP.ForbiddenErrorRetryNum2 = 999
		needUpdate = true
	}
	if r.Config.ICP.Concurrency <= 0 {
		r.Config.ICP.Concurrency = 5
		needUpdate = true
	}
	if r.Config.Wechat.DecompileConcurrency <= 0 {
		r.Config.Wechat.DecompileConcurrency = 5
		needUpdate = true
	}
	if r.Config.Wechat.ExtractConcurrency <= 0 {
		r.Config.Wechat.ExtractConcurrency = 20
		needUpdate = true
	}

	if len(r.Config.Wechat.Rules) == 0 {
		r.Config.Wechat.Rules = DefaultRegex
		needUpdate = true
	}

	isNewVersion := false

	currentVersion, _ := version.NewVersion(Version)
	configFileVersion, err := version.NewVersion(r.Config.Version)
	if err != nil || currentVersion.GreaterThan(configFileVersion) {
		r.Config.Version = Version
		isNewVersion = true
		needUpdate = true
	}

	// 创建默认规则副本
	defaultRuleCopy := make(matcher.RuleList, len(DefaultRegex))
	copy(defaultRuleCopy, DefaultRegex)

	// 找出自定义规则
	customRules := make(matcher.RuleList, 0)
	defaultRuleIDs := make(map[int64]bool)
	existingDefaultRules := make(map[int64]bool)

	// 获取默认规则的ID集合
	for _, rule := range DefaultRegex {
		defaultRuleIDs[rule.ID] = true
	}

	// 遍历现有规则
	for _, rule := range r.Config.Wechat.Rules {
		if !defaultRuleIDs[rule.ID] {
			// 不在默认规则ID中的为自定义规则
			customRules = append(customRules, rule)
		} else {
			if isNewVersion {
				continue
			}
			// 在默认规则中的,更新到默认规则副本中
			existingDefaultRules[rule.ID] = true
			for i, defaultRule := range defaultRuleCopy {
				if defaultRule.ID == rule.ID {
					defaultRuleCopy[i].Name = rule.Name
					defaultRuleCopy[i].Enable = rule.Enable
					break
				}
			}
		}
	}

	// 如果现有规则中缺少某些默认规则,则需要添加
	if len(existingDefaultRules) < len(DefaultRegex) {
		needUpdate = true
	}

	// 合并默认规则副本和自定义规则
	r.Config.Wechat.Rules = append(defaultRuleCopy, customRules...)
	if needUpdate {
		r.WriteConfig(r.Config)
	}

	//代理
	if r.Config.Proxy.Enable {
		var p string
		if r.Config.Proxy.User != "" && r.Config.Proxy.Pass != "" {
			p = fmt.Sprintf("%s://%s:%s@%s:%s", r.Config.Proxy.Type, r.Config.Proxy.User, r.Config.Proxy.Pass, r.Config.Proxy.Host, r.Config.Proxy.Port)
		} else {
			p = fmt.Sprintf("%s://%s:%s", r.Config.Proxy.Type, r.Config.Proxy.Host, r.Config.Proxy.Port)
		}
		if err := r.ProxyManager.SetProxy(p); err != nil {
			r.Logger.Error("set global proxy error: " + err.Error())
		}
		r.Logger.Info("global proxy enabled on " + r.ProxyManager.String())
	} else {
		if err := r.ProxyManager.SetProxy(""); err != nil {
			r.Logger.Error("reset global proxy error: " + err.Error())
		}
		r.Logger.Info("global proxy disabled")
	}

	//超时
	r.ProxyManager.SetTimeout(r.Config.Timeout)
	r.Logger.Info(fmt.Sprintf("set global timeout %fs", r.ProxyManager.GetClient().Timeout.Seconds()))
	return nil
}

// DetectWeChatAppletPath 尝试检测微信小程序路径，优先复用已配置路径并回退到常见目录
func (r *Application) DetectWeChatAppletPath() string {
	if path := normalizeAppletCandidate(r.Config.Wechat.Applet); path != "" {
		r.Logger.Info(fmt.Sprintf("检测到微信小程序路径: %s", path))
		return path
	}

	if envPath := normalizeAppletCandidate(os.Getenv("WECHAT_APPLET_PATH")); envPath != "" {
		r.Logger.Info(fmt.Sprintf("检测到微信小程序路径: %s", envPath))
		return envPath
	}

	for _, candidate := range envAppletCandidates() {
		if path := normalizeAppletCandidate(candidate); path != "" {
			r.Logger.Info(fmt.Sprintf("检测到微信小程序路径: %s", path))
			return path
		}
	}

	if runtime.GOOS == "windows" {
		return r.detectWeChatAppletPathWindows()
	}

	defaultCandidates := envAppletCandidates()
	switch runtime.GOOS {
	case "darwin":
		defaultCandidates = append(defaultCandidates,
			filepath.Join(r.UserHome, "Library", "Containers", "com.tencent.xinWeChat", "Data", ".wxapplet", "packages"),
			filepath.Join(r.UserHome, "Library", "Application Support", "com.tencent.xinWeChat", "Applet"),
			filepath.Join(r.UserHome, "Library", "Containers", "com.tencent.xinWeChat", "Data", "Library", "Application Support", "com.tencent.xinWeChat", "Applet"),
		)
	default:
		defaultCandidates = append(defaultCandidates,
			filepath.Join(r.UserHome, "WeChat", "Applet"),
		)
	}

	for _, candidate := range defaultCandidates {
		if path := normalizeAppletCandidate(candidate); path != "" {
			r.Logger.Info(fmt.Sprintf("检测到微信小程序路径: %s", path))
			return path
		}
	}

	r.Logger.Info("未检测到微信小程序路径，请手动配置")
	return ""
}

func (r *Application) detectWeChatAppletPathWindows() string {
	basePaths := []string{
		r.Config.Wechat.Applet,
		filepath.Join(r.UserHome, "AppData", "Roaming", "Tencent", "xwechat", "radium"),
		filepath.Join(r.UserHome, "AppData", "Roaming", "Tencent", "WeChat"),
		filepath.Join(r.UserHome, "AppData", "Roaming", "Tencent", "WeChatAppData"),
		filepath.Join(r.UserHome, "AppData", "Local", "Tencent", "WeChat"),
		filepath.Join(r.UserHome, "AppData", "LocalLow", "Tencent", "WeChat"),
		filepath.Join(r.UserHome, "Documents", "WeChat Files"),
		filepath.Join(r.UserHome, "Documents", "WeChat Files", "All Users"),
		filepath.Join(r.UserHome, "Documents", "WeChatData"),
		filepath.Join(r.UserHome, "OneDrive", "Documents", "WeChat Files"),
	}

	if oneDriveRoot := strings.TrimSpace(os.Getenv("OneDrive")); oneDriveRoot != "" {
		basePaths = append(basePaths, filepath.Join(oneDriveRoot, "Documents", "WeChat Files"))
	}

	if programData := strings.TrimSpace(os.Getenv("ProgramData")); programData != "" {
		basePaths = append(basePaths, filepath.Join(programData, "Tencent", "WeChat"))
	}

	if publicDir := strings.TrimSpace(os.Getenv("PUBLIC")); publicDir != "" {
		basePaths = append(basePaths, filepath.Join(publicDir, "Documents", "WeChat Files"))
	}

	basePaths = append(basePaths, envAppletCandidates()...)

	seen := make(map[string]struct{})
	uniq := make([]string, 0, len(basePaths))
	for _, item := range basePaths {
		item = strings.TrimSpace(item)
		if item == "" {
			continue
		}
		norm := filepath.Clean(item)
		if _, ok := seen[norm]; ok {
			continue
		}
		seen[norm] = struct{}{}
		uniq = append(uniq, norm)
	}

	maxDepth := 5
	found := make([]string, 0)
	foundSeen := make(map[string]struct{})
	addMatch := func(path string) {
		if path == "" {
			return
		}
		norm := filepath.Clean(path)
		if _, ok := foundSeen[norm]; ok {
			return
		}
		foundSeen[norm] = struct{}{}
		found = append(found, norm)
		r.Logger.Info(fmt.Sprintf("检测到微信小程序路径: %s", norm))
	}

	for _, base := range uniq {
		addMatch(normalizeAppletCandidate(base))
	}

	for _, base := range uniq {
		addMatch(searchWechatApplet(base, maxDepth))
	}

	if len(found) > 0 {
		if len(found) > 1 {
			r.Logger.Info(fmt.Sprintf("检测到多个微信小程序路径，默认使用: %s", found[0]))
		}
		return found[0]
	}

	r.Logger.Info("未检测到微信小程序路径，请手动配置")
	return ""
}

func normalizeAppletCandidate(path string) string {
	path = strings.TrimSpace(path)
	if path == "" {
		return ""
	}
	return checkAppletInPath(filepath.Clean(path))
}

func envAppletCandidates() []string {
	raw := strings.TrimSpace(os.Getenv("WECHAT_APPLET_CANDIDATES"))
	if raw == "" {
		return nil
	}
	parts := filepath.SplitList(raw)
	candidates := make([]string, 0, len(parts))
	for _, item := range parts {
		item = strings.TrimSpace(item)
		if item == "" {
			continue
		}
		candidates = append(candidates, item)
	}
	return candidates
}

func checkAppletInPath(path string) string {
	if path == "" {
		return ""
	}
	if isLikelyWechatAppletDir(path) {
		return path
	}

	suffixes := [][]string{
		{"Applet"},
		{"Applets"},
		{"packages"},
		{"Applet", "packages"},
		{"Applets", "packages"},
	}

	for _, parts := range suffixes {
		candidate := filepath.Join(append([]string{path}, parts...)...)
		if isLikelyWechatAppletDir(candidate) {
			return candidate
		}
	}

	return ""
}

func searchWechatApplet(root string, maxDepth int) string {
	root = strings.TrimSpace(root)
	if root == "" {
		return ""
	}
	info, err := os.Stat(root)
	if err != nil || !info.IsDir() {
		return ""
	}

	type level struct {
		path  string
		depth int
	}

	queue := []level{{path: filepath.Clean(root), depth: 0}}
	visited := make(map[string]struct{})

	for len(queue) > 0 {
		current := queue[0]
		queue = queue[1:]
		norm := filepath.Clean(current.path)
		if _, ok := visited[norm]; ok {
			continue
		}
		visited[norm] = struct{}{}

		if path := checkAppletInPath(norm); path != "" {
			return path
		}

		if current.depth >= maxDepth {
			continue
		}

		entries, err := os.ReadDir(norm)
		if err != nil {
			continue
		}
		for _, entry := range entries {
			if !entry.IsDir() {
				continue
			}
			next := filepath.Join(norm, entry.Name())
			queue = append(queue, level{path: next, depth: current.depth + 1})
		}
	}

	return ""
}

func isLikelyWechatAppletDir(path string) bool {
	info, err := os.Stat(path)
	if err != nil || !info.IsDir() {
		return false
	}

	if containsAppletMarker(path, 2) {
		return true
	}

	return false
}

func containsAppletMarker(path string, depth int) bool {
	if depth < 0 {
		return false
	}

	entries, err := os.ReadDir(path)
	if err != nil {
		return false
	}

	for _, entry := range entries {
		name := strings.ToLower(entry.Name())
		if !entry.IsDir() {
			if strings.HasSuffix(name, ".wxapkg") || strings.Contains(name, "app-config") || strings.Contains(name, "app.json") || strings.Contains(name, "project.config") {
				return true
			}
			continue
		}
		if depth == 0 {
			continue
		}
		child := filepath.Join(path, entry.Name())
		if containsAppletMarker(child, depth-1) {
			return true
		}
	}

	return false
}

func (r *Application) generateConfigFile() error {
	defaultConfig.LogDataDir = filepath.Join(r.AppDir, "data", "log")
	defaultConfig.DatabaseFile = filepath.Join(r.AppDir, "data", "data.db")
	defaultConfig.WechatDataDir = filepath.Join(r.AppDir, "data", "wechat")
	defaultConfig.ExportDataDir = filepath.Join(r.AppDir, "data", "export")

	r.Logger = logger.NewWithLogDir(defaultConfig.LogDataDir)
	r.Logger.Info("config file not found, generating default config file...")

	// 自动检测微信小程序路径
	if runtime.GOOS == "windows" {
		// Windows平台自动检测路径
		defaultConfig.Wechat.Applet = r.DetectWeChatAppletPath()
	} else {
		// 非 windows 下微信小程序默认目录
		defaultConfig.Wechat.Applet = filepath.Join(r.UserHome, "Library/Containers/com.tencent.xinWeChat/Data/.wxapplet/packages")
	}

	// 应用默认配置
	r.Config = defaultConfig

	// 保存到本地
	if err := r.WriteConfig(defaultConfig); err != nil {
		msg := "can't generate default config file: " + err.Error()
		return errors.New(msg)
	}

	r.Logger.Info("generate default config file successfully, locate at " + r.ConfigFile + ", run with default config")

	// 超时
	r.ProxyManager.SetTimeout(r.Config.Timeout)
	r.Logger.Info(fmt.Sprintf("set timeout %fs", r.ProxyManager.GetClient().Timeout.Seconds()))

	return nil
}

func (r *Application) CheckRunningTask() {

}

// Exit 关闭应用
func (r *Application) Exit() {
	os.Exit(0)
}

func (r *Application) GetProxyHistory() ([]config.Proxy, error) {
	histories, _, err := r.proxyHistoryRepo.GetByPagination(1, 20)
	if err != nil {
		return nil, err
	}
	items := make([]config.Proxy, 0)
	for _, proxyHistory := range histories {
		items = append(items, proxyHistory.Proxy)
	}
	return items, nil
}

func ShowErrorMessage(message string) {
	switch runtime.GOOS {
	case "darwin":
		exec.Command("osascript", "-e", `display dialog "`+message+`" buttons {"OK"} default button 1`).Run()
	case "windows":
		exec.Command("powershell", "-Command", `[System.Windows.Forms.MessageBox]::Show('`+message+`', 'Error', 'OK')`).Run()
	case "linux":
		exec.Command("zenity", "--error", "--text", message).Run()
	default:
		panic(message)
	}
}

func (r *Application) UseProxyManager(manager *goproxy.GoProxy) {
	r.http = manager.GetClient()
}

func (r *Application) SetContext(ctx context.Context) {
	r.startup(ctx)
}

func (r *Application) GetContext() context.Context {
	return r.ctx
}

// startup is called when the app starts. The context is saved
// so we can call the runtime methods
func (r *Application) startup(ctx context.Context) {
	r.ctx = ctx
}

func (r *Application) Fetch(url string) ([]byte, error) {
	url = strings.TrimSpace(url)
	if url == "" {
		return nil, errors.New("目标地址不能为空")
	}
	request, _ := http.NewRequest("GET", url, nil)
	response, err := r.http.Do(request)
	if err != nil {
		r.Logger.Info(err)
		return nil, err
	}
	if response.StatusCode != 200 {
		return nil, errors.New(strconv.Itoa(response.StatusCode))
	}
	bytes, err := io.ReadAll(response.Body)
	return bytes, err
}

func (r *Application) CheckUpdate() (map[string]string, error) {
	// 自动更新功能已禁用
	return map[string]string{
		"version":     "",
		"description": "自动更新功能已禁用",
		"url":         "",
	}, nil
}

func (r *Application) SaveProxy(proxy config.Proxy) error {
	r.Config.Proxy.Type = proxy.Type
	r.Config.Proxy.Enable = proxy.Enable
	r.Config.Proxy.Host = proxy.Host
	r.Config.Proxy.Port = proxy.Port
	r.Config.Proxy.User = proxy.User
	r.Config.Proxy.Pass = proxy.Pass
	if err := r.WriteConfig(r.Config); err != nil {
		msg := "can't store global proxy to file"
		r.Logger.Info(msg)
		return errors.New(msg)
	}
	if proxy.Enable {
		if proxy.User != "" {
			auth := proxy.User
			if proxy.Pass != "" {
				auth += ":" + proxy.Pass + "@"
				_ = r.ProxyManager.SetProxy(fmt.Sprintf("%s://%s%s:%s", proxy.Type, auth, proxy.Host, proxy.Port))
				r.Logger.Info("global proxy enabled on " + r.ProxyManager.String())
				return nil
			}
		}
		_ = r.ProxyManager.SetProxy(fmt.Sprintf("%s://%s:%s", proxy.Type, proxy.Host, proxy.Port))
		r.Logger.Info("global proxy enabled on " + r.ProxyManager.String())
		if err := r.proxyHistoryRepo.Create(models.ProxyHistory{
			Proxy: proxy,
		}); err != nil {
			r.Logger.Info(err)
		}
		return nil
	}
	_ = r.ProxyManager.SetProxy("")
	r.Logger.Info("global proxy disabled")
	return nil
}

func (r *Application) WriteConfig(conf *config.Config) error {
	bytes, err := yaml.Marshal(conf)
	if err != nil {
		return err
	}
	return utils.WriteFile(r.ConfigFile, bytes, 0764)
}

func (r *Application) SaveQueryOnEnter(queryOnEnter config.QueryOnEnter) error {
	r.Config.QueryOnEnter = queryOnEnter
	err := r.WriteConfig(r.Config)
	if err != nil {
		r.Logger.Info(err)
		return err
	}
	return nil
}

func (r *Application) SaveTimeout(timeout time.Duration) error {
	r.Config.Timeout = timeout
	err := r.WriteConfig(r.Config)
	if err != nil {
		r.Logger.Info(err)
		return err
	}
	r.ProxyManager.SetTimeout(timeout)
	return nil
}

func (r *Application) SaveDatabaseFile(file string) error {
	r.Config.DatabaseFile = file
	err := r.WriteConfig(r.Config)
	if err != nil {
		r.Logger.Info(err)
		return err
	}
	return nil
}

func (r *Application) SaveExportDataDir(dir string) error {
	r.Config.ExportDataDir = dir
	err := r.WriteConfig(r.Config)
	if err != nil {
		r.Logger.Info(err)
		return err
	}
	return nil
}

func (r *Application) SaveWechatDataDir(dir string) error {
	r.Config.WechatDataDir = dir
	err := r.WriteConfig(r.Config)
	if err != nil {
		r.Logger.Info(err)
		return err
	}
	return nil
}

func (r *Application) SaveLogDataDir(dir string) error {
	r.Config.LogDataDir = dir
	err := r.WriteConfig(r.Config)
	if err != nil {
		r.Logger.Info(err)
		return err
	}
	return nil
}

func (r *Application) GetAllConstants() *Constant {
	var statuses = status.StatusEnum{
		Pending: status.Pending,
		Running: status.Running,
		Paused:  status.Paused,
		Stopped: status.Stopped,
		Deleted: status.Deleted,
		Error:   status.Error,
		OK:      status.OK,
		Waiting: status.Waiting,
		ReRun:   status.ReRun,
		Pausing: status.Pausing,
	}
	var events = event.EventEnum{
		AppExit:                      event.AppExit,
		WindowSizeChange:             event.WindowSizeChange,
		FOFAExport:                   event.FOFAExport,
		NewDownloadItem:              event.NewExportItem,
		NewExportLog:                 event.NewExportLog,
		HunterExport:                 event.HunterExport,
		HunterQuery:                  event.HunterQuery,
		ICPExport:                    event.ICPExport,
		QuakeExport:                  event.QuakeExport,
		ZoneSiteExport:               event.ZoneSiteExport,
		ZoneMemberExport:             event.ZoneMemberExport,
		ZoneEmailExport:              event.ZoneEmailExport,
		Httpx:                        event.Httpx,
		DecompileWxMiniAPP:           event.DecompileWxMiniAPP,
		DecompileWxMiniAPPTicker:     event.DecompileWxMiniAPPTicker,
		DecompileWxMiniAPPInfoTicker: event.DecompileWxMiniAPPInfoTicker,
		ICPBatchQuery:                event.ICPBatchQuery,
		ICPBatchQueryStatusUpdate:    event.ICPBatchQueryStatusUpdate,
		AiQiCha:                      event.AiQiCha,
		GogoTaskUpdate:               event.GogoTaskUpdate,
	}

	var histories = history.HistoryEnum{
		FOFA:   history.FOFA,
		Hunter: history.Hunter,
		Quake:  history.Quake,
		Zone:   history.Zone,
		ICP:    history.ICP,
		TYC:    history.TYC,
		AQC:    history.AQC,
		Shodan: history.Shodan,
	}
	return &Constant{
		Event:   events,
		Status:  statuses,
		History: histories,
		Config:  *r.Config,
	}
}

func (r *Application) EvenDetail() *event.EventDetail {
	return nil
}

type Constant struct {
	Event   event.EventEnum     `json:"event"`
	Status  status.StatusEnum   `json:"status"`
	History history.HistoryEnum `json:"history"`
	Config  config.Config       `json:"config"`
}

func (r *Application) GetSystemInfo() *utils.SystemStats {
	stats, err := utils.GetSystemStats()
	if err != nil {
		r.Logger.Error("获取系统信息失败: " + err.Error())
		return nil
	}
	return stats
}
