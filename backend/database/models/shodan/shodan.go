package shodan

import (
	"mfinder/backend/database/models"
	"mfinder/backend/service/model/shodan"
	"mfinder/backend/service/model/shodan/properties"
)

type General struct {
	models.BaseModel
	PageID int64
	*properties.General
}

type Facets struct {
	models.BaseModel
	PageID int64
	shodan.Facets
}

type HostSearchResult struct {
	models.BaseModel
	PageID  int64
	Matches []General `gorm:"foreignKey:PageID;references:PageID"`
	Facets  Facets    `gorm:"foreignKey:PageID;references:PageID"`
	Total   int64
}

type QueryLog struct {
	models.BaseModel
	PageID int64 `gorm:"unique"`
	Query  string
	Facets string
	Minify bool
}
