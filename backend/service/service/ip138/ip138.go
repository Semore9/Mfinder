package ip138

import (
	"mfinder/backend/application"
	"github.com/fasnow/goproxy"
	"net/http"
)

// 从baseReadURL获取ip解析结果，如果有则直接返回结果
// 如果没有，则先从baseURL页面获取一个_TOKEN，利用该_TOKEN通过baseWriteURL先写入对应的域名，然后再访问baseReadURL即可

const (
	// https://site.ip138.com/baidu.com/
	Ip138BaseURL = "https://site.ip138.com/"

	// Ip138BaseReadURL https://site.ip138.com/domain/read.do?domain=baidu.com
	Ip138BaseReadURL = "https://site.ip138.com/domain/read.do"

	// Ip138BaseWriteURL https://site.ip138.com/domain/write.do?type=domain&input=baidu.com&token=b38c4d8e0f2cc338ffbaabf1042fc30f
	Ip138BaseWriteURL = "https://site.ip138.com/domain/write.do"
	// Ip138BaseLocateURL https://api.ip138.com/query/?ip=104.21.53.119&oid=5&mid=5&from=siteFront&datatype=json&sign=e42751019ebb86b656608094f965b2b4
	Ip138BaseLocateURL = "https://api.ip138.com/query/"

	// Ip138UserAgent must look like a modern browser, otherwise ip138 will
	// consistently return `{status:false, code:300}` responses.
	Ip138UserAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36"
)

type Response struct {
	Status bool   `json:"status"`
	Code   int    `json:"code"`
	Msg    string `json:"msg"`
	Data   []struct {
		IP   string `json:"ip"`
		Sign string `json:"sign"`
	} `json:"data"`
}

type IP138 struct {
	http   *http.Client
	domain string
	Domain *domain
	IP     *ip
}

func NewClient() *IP138 {
	client := &IP138{
		http: &http.Client{
			Timeout: application.DefaultApp.Config.Timeout,
		},
		Domain: &domain{},
		IP:     &ip{},
	}
	client.Domain.client = client
	client.IP.client = client
	return client
}

func (r *IP138) UseProxyManager(manager *goproxy.GoProxy) {
	r.http = manager.GetClient()
}
