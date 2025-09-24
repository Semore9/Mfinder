package models

import "mfinder/backend/config"

type ProxyHistory struct {
	BaseModel
	config.Proxy
}
