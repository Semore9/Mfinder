package history

import (
	"mfinder/backend/application"
	"mfinder/backend/database"
	"mfinder/backend/database/repository"
)

type Bridge struct {
	app         *application.Application
	historyRepo repository.HistoryRepository
}

func NewBridge(app *application.Application) *Bridge {
	return &Bridge{
		app:         app,
		historyRepo: repository.NewHistoryRepository(database.GetConnection()),
	}
}

func (r *Bridge) FindByPartialKey(ht int, key string) []string {
	items, err := r.historyRepo.FindByPartialKey(ht, key, 100)
	if err != nil {
		r.app.Logger.Error(err)
		return nil
	}
	t := make([]string, 0)
	for _, item := range items {
		t = append(t, item.Key)
	}
	return t
}
