package tianyancha

import (
	"encoding/json"
	"mfinder/backend/application"
	"testing"

	"github.com/fasnow/goproxy"
)

func TestTianYanCha_GetIndustryList(t *testing.T) {
	c := NewClient(application.DefaultApp.Config.TianYanCha.Token)
	c.UseProxyManager(goproxy.New())
	list, err := c.GetIndustryList()
	if err != nil {
		t.Error(err)
		return
	}
	marshal, e := json.Marshal(list)
	if e != nil {
		return
	}
	t.Log(string(marshal))
}

func TestTianYanCha_GetAreaList(t *testing.T) {
	c := NewClient(application.DefaultApp.Config.TianYanCha.Token)
	c.UseProxyManager(goproxy.New())
	list, err := c.GetAreaList()
	if err != nil {
		t.Error(err)
		return
	}
	marshal, e := json.Marshal(list)
	if e != nil {
		return
	}
	t.Log(string(marshal))
}

func TestTianYanCha_Search(t *testing.T) {
	c := NewClient(application.DefaultApp.Config.TianYanCha.Token)
	m := goproxy.New()
	_ = m.SetProxy("http://127.0.0.1:8081")
	c.UseProxyManager(m)
	c.SetAuth("eyJhbGciOiJIUzUxMiJ9.eyJzdWIiOiIxMzA5NjM1NTMzMCIsImlhdCI6MTczMzYzMTM5NSwiZXhwIjoxNzM2MjIzMzk1fQ.dM3nb_JiiIRO1Zahilrdrlygi0I0G_z4OWHPMlgJ5NKJpZ31E3OYTx07Y_BvrTrCdhyDmfz830JU6m9NeyGciQ")
	list, err := c.Search("中国邮政")
	if err != nil {
		t.Error(err)
		return
	}
	marshal, e := json.Marshal(*list)
	if e != nil {
		return
	}
	t.Log(string(marshal))
}

func TestTianYanCha_Suggest(t *testing.T) {
	c := NewClient(application.DefaultApp.Config.TianYanCha.Token)
	m := goproxy.New()
	_ = m.SetProxy("http://127.0.0.1:8081")
	c.UseProxyManager(m)
	c.SetAuth("eyJhbGciOiJIUzUxMiJ9.eyJzdWIiOiIxMzA5NjM1NTMzMCIsImlhdCI6MTczMzYzMTM5NSwiZXhwIjoxNzM2MjIzMzk1fQ.dM3nb_JiiIRO1Zahilrdrlygi0I0G_z4OWHPMlgJ5NKJpZ31E3OYTx07Y_BvrTrCdhyDmfz830JU6m9NeyGciQ")
	list, err := c.Suggest("中国邮政")
	if err != nil {
		t.Error(err)
		return
	}
	marshal, e := json.Marshal(list)
	if e != nil {
		return
	}
	t.Log(string(marshal))
}

func TestTianYanCha_GetInvestee(t *testing.T) {
	c := NewClient(application.DefaultApp.Config.TianYanCha.Token)
	m := goproxy.New()
	_ = m.SetProxy("http://127.0.0.1:8081")
	c.UseProxyManager(m)
	c.SetAuth("eyJhbGciOiJIUzUxMiJ9.eyJzdWIiOiIxMzA5NjM1NTMzMCIsImlhdCI6MTczMzYzMTM5NSwiZXhwIjoxNzM2MjIzMzk1fQ.dM3nb_JiiIRO1Zahilrdrlygi0I0G_z4OWHPMlgJ5NKJpZ31E3OYTx07Y_BvrTrCdhyDmfz830JU6m9NeyGciQ")
	list, err := c.GetInvestee("2954613365")
	if err != nil {
		t.Error(err)
		return
	}
	marshal, e := json.Marshal(list)
	if e != nil {
		return
	}
	t.Log(string(marshal))
}

func TestTianYanCha_GetHolder(t *testing.T) {
	c := NewClient(application.DefaultApp.Config.TianYanCha.Token)
	m := goproxy.New()
	_ = m.SetProxy("http://127.0.0.1:8081")
	c.UseProxyManager(m)
	c.SetAuth("eyJhbGciOiJIUzUxMiJ9.eyJzdWIiOiIxMzA5NjM1NTMzMCIsImlhdCI6MTczMzYzMTM5NSwiZXhwIjoxNzM2MjIzMzk1fQ.dM3nb_JiiIRO1Zahilrdrlygi0I0G_z4OWHPMlgJ5NKJpZ31E3OYTx07Y_BvrTrCdhyDmfz830JU6m9NeyGciQ")
	list, err := c.GetHolder("2954613365")
	if err != nil {
		t.Error(err)
		return
	}
	marshal, e := json.Marshal(list)
	if e != nil {
		return
	}
	t.Log(string(marshal))
}
