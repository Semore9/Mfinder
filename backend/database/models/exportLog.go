package models

import "mfinder/backend/service/model/exportlog"

type ExportLog struct {
	BaseModel
	exportlog.Item
}

func (ExportLog) TableName() string {
	return "export_log"
}
