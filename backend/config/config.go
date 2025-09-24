package config

import (
	"mfinder/backend/matcher"
	"time"
)

type Fofa struct {
	Token    string        `ini:"token" `
	Interval time.Duration `ini:"interval"  comment:"接口请求间隔，默认:0.3s"`
}
type Hunter struct {
	Token    string        `ini:"token" `
	Interval time.Duration `ini:"interval"  comment:"接口请求间隔，默认:1.5s"`
}
type Quake struct {
	Token    string        `ini:"token" `
	Interval time.Duration `ini:"interval"  comment:"接口请求间隔，默认:1s"`
}
type Zone struct {
	Token    string        `ini:"token" `
	Interval time.Duration `ini:"interval"  comment:"接口请求间隔，默认:1s"`
}
type Shodan struct {
	Token    string
	Interval time.Duration
}
type Proxy struct {
	Enable bool   `ini:"enable" `
	Type   string `ini:"type"  comment:"http,socks5"`
	Host   string `ini:"host" `
	Port   string `ini:"port" `
	User   string `ini:"user" `
	Pass   string `ini:"pass" `
}

type Wechat struct {
	Applet string `ini:"applet" `
	//AdafruitAPIKey bool   `ini:"Adafruit_API_Key"`
	//AirtableAPIKey bool   `ini:"Airtable_API_Key"`
	//AlgoliaAPIKey  bool   `ini:"Algolia_API_Key"`
	//AdafruitAPIKey bool   `ini:"Adafruit_API_Key"`
	//AdafruitAPIKey bool   `ini:"Adafruit_API_Key"`
	//AdafruitAPIKey bool   `ini:"Adafruit_API_Key"`
	//AdafruitAPIKey bool   `ini:"Adafruit_API_Key"`
	//AdafruitAPIKey bool   `ini:"Adafruit_API_Key"`
	//AdafruitAPIKey bool   `ini:"Adafruit_API_Key"`
	//AdafruitAPIKey bool   `ini:"Adafruit_API_Key"`
	//AdafruitAPIKey bool   `ini:"Adafruit_API_Key"`
	//AdafruitAPIKey bool   `ini:"Adafruit_API_Key"`
	//AdafruitAPIKey bool   `ini:"Adafruit_API_Key"`
	//AdafruitAPIKey bool   `ini:"Adafruit_API_Key"`
	//AdafruitAPIKey bool   `ini:"Adafruit_API_Key"`
	//AdafruitAPIKey bool   `ini:"Adafruit_API_Key"`
	//AdafruitAPIKey bool   `ini:"Adafruit_API_Key"`
	//AdafruitAPIKey bool   `ini:"Adafruit_API_Key"`
	//AdafruitAPIKey bool   `ini:"Adafruit_API_Key"`
	//AdafruitAPIKey bool   `ini:"Adafruit_API_Key"`
	//AdafruitAPIKey bool   `ini:"Adafruit_API_Key"`
	//AdafruitAPIKey bool   `ini:"Adafruit_API_Key"`
	//AdafruitAPIKey bool   `ini:"Adafruit_API_Key"`
	//AdafruitAPIKey bool   `ini:"Adafruit_API_Key"`
	//AdafruitAPIKey bool   `ini:"Adafruit_API_Key"`
	//AdafruitAPIKey bool   `ini:"Adafruit_API_Key"`
	//AdafruitAPIKey bool   `ini:"Adafruit_API_Key"`
	//AdafruitAPIKey bool   `ini:"Adafruit_API_Key"`
	//AdafruitAPIKey bool   `ini:"Adafruit_API_Key"`
	//AdafruitAPIKey bool   `ini:"Adafruit_API_Key"`
	//AdafruitAPIKey bool   `ini:"Adafruit_API_Key"`
	//AdafruitAPIKey bool   `ini:"Adafruit_API_Key"`
	//AdafruitAPIKey bool   `ini:"Adafruit_API_Key"`
	//AdafruitAPIKey bool   `ini:"Adafruit_API_Key"`
	//AdafruitAPIKey bool   `ini:"Adafruit_API_Key"`
	//AdafruitAPIKey bool   `ini:"Adafruit_API_Key"`
	//AdafruitAPIKey bool   `ini:"Adafruit_API_Key"`
	//AdafruitAPIKey bool   `ini:"Adafruit_API_Key"`
	//AdafruitAPIKey bool   `ini:"Adafruit_API_Key"`
	//AdafruitAPIKey bool   `ini:"Adafruit_API_Key"`
	//AdafruitAPIKey bool   `ini:"Adafruit_API_Key"`
	//AdafruitAPIKey bool   `ini:"Adafruit_API_Key"`
	//AdafruitAPIKey bool   `ini:"Adafruit_API_Key"`
	//AdafruitAPIKey bool   `ini:"Adafruit_API_Key"`
	//AdafruitAPIKey bool   `ini:"Adafruit_API_Key"`
	//AdafruitAPIKey bool   `ini:"Adafruit_API_Key"`
	//AdafruitAPIKey bool   `ini:"Adafruit_API_Key"`
	//AdafruitAPIKey bool   `ini:"Adafruit_API_Key"`
	//AdafruitAPIKey bool   `ini:"Adafruit_API_Key"`
	//AdafruitAPIKey bool   `ini:"Adafruit_API_Key"`
	//AdafruitAPIKey bool   `ini:"Adafruit_API_Key"`
	//AdafruitAPIKey bool   `ini:"Adafruit_API_Key"`
	//AdafruitAPIKey bool   `ini:"Adafruit_API_Key"`
	//AdafruitAPIKey bool   `ini:"Adafruit_API_Key"`
	//AdafruitAPIKey bool   `ini:"Adafruit_API_Key"`
	//AdafruitAPIKey bool   `ini:"Adafruit_API_Key"`
	//AdafruitAPIKey bool   `ini:"Adafruit_API_Key"`
	//AdafruitAPIKey bool   `ini:"Adafruit_API_Key"`
	//AdafruitAPIKey bool   `ini:"Adafruit_API_Key"`
	//AdafruitAPIKey bool   `ini:"Adafruit_API_Key"`
	//AdafruitAPIKey bool   `ini:"Adafruit_API_Key"`
	//AdafruitAPIKey bool   `ini:"Adafruit_API_Key"`
	//AdafruitAPIKey bool   `ini:"Adafruit_API_Key"`
	//AdafruitAPIKey bool   `ini:"Adafruit_API_Key"`
	//AdafruitAPIKey bool   `ini:"Adafruit_API_Key"`
	//AdafruitAPIKey bool   `ini:"Adafruit_API_Key"`
	//AdafruitAPIKey bool   `ini:"Adafruit_API_Key"`
	//AdafruitAPIKey bool   `ini:"Adafruit_API_Key"`
	//AdafruitAPIKey bool   `ini:"Adafruit_API_Key"`
	//AdafruitAPIKey bool   `ini:"Adafruit_API_Key"`
	//AdafruitAPIKey bool   `ini:"Adafruit_API_Key"`
	//AdafruitAPIKey bool   `ini:"Adafruit_API_Key"`
	//AdafruitAPIKey bool   `ini:"Adafruit_API_Key"`
	//AdafruitAPIKey bool   `ini:"Adafruit_API_Key"`
	//AdafruitAPIKey bool   `ini:"Adafruit_API_Key"`
	//AdafruitAPIKey bool   `ini:"Adafruit_API_Key"`
	//AdafruitAPIKey bool   `ini:"Adafruit_API_Key"`
	//AdafruitAPIKey bool   `ini:"Adafruit_API_Key"`
	//AdafruitAPIKey bool   `ini:"Adafruit_API_Key"`
	//AdafruitAPIKey bool   `ini:"Adafruit_API_Key"`
	//AdafruitAPIKey bool   `ini:"Adafruit_API_Key"`
	//AdafruitAPIKey bool   `ini:"Adafruit_API_Key"`
	//AdafruitAPIKey bool   `ini:"Adafruit_API_Key"`
	//AdafruitAPIKey bool   `ini:"Adafruit_API_Key"`
	DecompileConcurrency int
	ExtractConcurrency   int
	Rules                matcher.RuleList
}

type Httpx struct {
	Path                   string `ini:"path"`
	Flags                  string `ini:"flags"  comment:"额外的自定义程序参数（不包括目标输入参数标志）"`
	Silent                 bool   `ini:"silent"  comment:"默认添加 -silent"`
	JSON                   bool   `ini:"json"  comment:"默认输出 JSON (-json)"`
	StatusCode             bool   `ini:"statusCode"  comment:"输出状态码 (-sc)"`
	Title                  bool   `ini:"title"  comment:"输出标题 (-title)"`
	ContentLength          bool   `ini:"contentLength"  comment:"输出内容长度 (-cl)"`
	TechnologyDetect       bool   `ini:"technology"  comment:"输出技术栈 (-td)"`
	WebServer              bool   `ini:"webServer"  comment:"输出 Web Server (-server)"`
	IP                     bool   `ini:"ip"  comment:"输出 IP (-ip)"`
	Screenshot             bool   `ini:"screenshot"  comment:"启用截图 (-screenshot)"`
	ScreenshotSystemChrome bool   `ini:"screenshotSystemChrome"  comment:"截图使用系统 Chrome (-system-chrome)"`
	ScreenshotDirectory    string `ini:"screenshotDirectory"  comment:"截图输出目录 (-srd)"`
	TempDirectory          string `ini:"tempDirectory"  comment:"httpx 临时文件目录(如 leakless, 为空则使用系统默认)"`
	ScreenshotMode               string  `ini:"screenshotMode"  comment:"截图模式: external/internal"`
	ScreenshotBrowserPath        string  `ini:"screenshotBrowserPath"  comment:"internal 模式指定浏览器路径"`
	ScreenshotTimeout            string  `ini:"screenshotTimeout"  comment:"internal 模式单次截图总超时"`
	ScreenshotViewportWidth      int     `ini:"screenshotViewportWidth"  comment:"internal 模式视口宽度"`
	ScreenshotViewportHeight     int     `ini:"screenshotViewportHeight"  comment:"internal 模式视口高度"`
	ScreenshotDeviceScaleFactor  float64 `ini:"screenshotDeviceScaleFactor"  comment:"internal 模式 device scale"`
	ScreenshotQuality            int     `ini:"screenshotQuality"  comment:"internal 模式 PNG 质量"`
	ScreenshotConcurrency        int     `ini:"screenshotConcurrency"  comment:"internal 模式并发截图数"`
}

type Gogo struct {
	Ports                  string        `ini:"ports"  comment:"默认端口配置，支持 gogo 预设标签"`
	Mode                   string        `ini:"mode"   comment:"默认扫描模式，默认值: default"`
	Threads                int           `ini:"threads" comment:"默认并发线程数，0 表示根据系统自动选择"`
	Delay                  time.Duration `ini:"delay" comment:"套接字连接超时时间"`
	HTTPSDelay             time.Duration `ini:"httpsDelay" comment:"TLS 额外握手超时时间"`
	Exploit                string        `ini:"exploit" comment:"默认 POC 设置，none/auto/自定义标签"`
	Verbose                int           `ini:"verbose" comment:"默认指纹识别等级"`
	ResolveHosts           bool          `ini:"resolveHosts" comment:"是否解析域名并展开全部 A/AAAA 记录"`
	ResolveIPv6            bool          `ini:"resolveIPv6" comment:"解析域名时是否包含 IPv6 地址"`
	PreflightEnable        bool          `ini:"preflightEnable" comment:"启用扫描前活性预检"`
	PreflightPorts         string        `ini:"preflightPorts" comment:"预检使用的端口列表"`
	PreflightTimeout       time.Duration `ini:"preflightTimeout" comment:"单个预检端口超时时间"`
	AllowLoopback          bool          `ini:"allowLoopback" comment:"允许扫描回环地址"`
	AllowPrivate           bool          `ini:"allowPrivate" comment:"允许扫描私网地址"`
	WorkerLabel            string        `ini:"workerLabel" comment:"标记当前执行节点名称"`
	ConcurrencyMode        string        `ini:"concurrencyMode" comment:"并发策略：auto/manual"`
	ConcurrencyThreads     int           `ini:"concurrencyThreads" comment:"手动模式下的线程数"`
	ConcurrencyMaxThreads  int           `ini:"concurrencyMaxThreads" comment:"自动模式最大线程数"`
	ConcurrencyMaxPps      int           `ini:"concurrencyMaxPps" comment:"全局每秒操作上限"`
	ConcurrencyPerIpMaxPps int           `ini:"concurrencyPerIpMaxPps" comment:"单 IP 每秒操作上限"`
}

type DNS struct {
	Value []string `ini:"value,,allowshadow" `
}

type QueryOnEnter struct {
	Assets bool `ini:"assets" `
	ICP    bool `ini:"icp" `
	IP138  bool `ini:"ip138" `
}

type TianYanCha struct {
	Token string `ini:"token"  comment:"X-AUTH-TOKEN"`
}

type AiQiCha struct {
	Cookie string `ini:"cookie"  comment:"cookie"`
}

type ICP struct {
	Timeout                 time.Duration `ini:"timeout"  comment:"批量查询时的代理超时时间"`
	Proxy                   Proxy         `ini:"IcpProxy"  comment:"ICP代理,优先级高于全局"`
	AuthErrorRetryNum1      uint64        `ini:"authErrorRetryNum1"  comment:"单查询时认证错误重试次数"`
	ForbiddenErrorRetryNum1 uint64        `ini:"forbiddenErrorRetryNum1"  comment:"单查询时403错误误重试次数，不使用代理时建议设为0"`
	AuthErrorRetryNum2      uint64        `ini:"authErrorRetryNum2"  comment:"批量查询时认证错误重试次数"`
	ForbiddenErrorRetryNum2 uint64        `ini:"forbiddenErrorRetryNum2"  comment:"批量查询403错误误重试次数"`
	Concurrency             uint64        `ini:"limit"  comment:"最大线程数"`
}

type Config struct {
	Version       string
	DatabaseFile  string        `ini:"databaseFile" `
	WechatDataDir string        `ini:"wechatDataDir" `
	ExportDataDir string        `ini:"exportDataDir" `
	LogDataDir    string        `ini:"logDataDir" `
	Timeout       time.Duration `ini:"timeout"  comment:"全局HTTP超时（不含Httpx），默认:20s"`
	Proxy         Proxy         `comment:"全局代理"`
	Fofa          Fofa
	Hunter        Hunter
	Quake         Quake
	Zone          Zone `ini:"0.zone"`
	Shodan        Shodan
	ICP           ICP
	TianYanCha    TianYanCha
	AiQiCha       AiQiCha
	Wechat        Wechat
	Httpx         Httpx
	Gogo          Gogo
	QueryOnEnter  QueryOnEnter
}
