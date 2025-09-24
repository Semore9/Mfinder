package main

import (
	"context"
	"embed"
	"mfinder/backend/application"
	"mfinder/backend/constant/event"
	history2 "mfinder/backend/constant/history"
	"mfinder/backend/constant/status"
	"mfinder/backend/osoperation"
	"mfinder/backend/service/service/aiqicha"
	"mfinder/backend/service/service/exportlog"
	"mfinder/backend/service/service/fofa"
	gogoService "mfinder/backend/service/service/gogo"
	"mfinder/backend/service/service/history"
	"mfinder/backend/service/service/httpx"
	"mfinder/backend/service/service/hunter"
	"mfinder/backend/service/service/icp"
	"mfinder/backend/service/service/ip138"
	"mfinder/backend/service/service/quake"
	"mfinder/backend/service/service/shodan"
	"mfinder/backend/service/service/tianyancha"
	"mfinder/backend/service/service/wechat"
	"runtime"
	"time"

	"github.com/sirupsen/logrus"
	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/logger"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
	"github.com/wailsapp/wails/v2/pkg/options/mac"
	"github.com/wailsapp/wails/v2/pkg/options/windows"
	wailsRuntime "github.com/wailsapp/wails/v2/pkg/runtime"
)

//go:embed all:frontend/dist
var assets embed.FS

func main() {
	defaultWidth := 1200
	defaultHeight := 800
	mainApp := application.DefaultApp
	opts := &options.App{
		LogLevel: logger.DEBUG,
		Title:    "MFinder",
		Width:    defaultWidth,
		Height:   defaultHeight,
		OnBeforeClose: func(ctx context.Context) (prevent bool) {
			event.EmitV2(event.AppExit, event.EventDetail{})
			if wailsRuntime.WindowIsMinimised(ctx) {
				wailsRuntime.WindowUnminimise(ctx)
			}
			wailsRuntime.WindowSetAlwaysOnTop(ctx, true)
			time.AfterFunc(100*time.Millisecond, func() {
				wailsRuntime.WindowShow(ctx)
				wailsRuntime.WindowSetAlwaysOnTop(ctx, false)
			})
			return true
		},
		Frameless: runtime.GOOS != "darwin",
		AssetServer: &assetserver.Options{
			Assets: assets,
		},
		Mac: &mac.Options{
			TitleBar: mac.TitleBarHiddenInset(),
			//WebviewIsTransparent: false,
			//WindowIsTranslucent:  true,
		},
		Windows: &windows.Options{
			//WebviewIsTransparent:              true,
			//WindowIsTranslucent:               true,
			//DisableFramelessWindowDecorations: true,
		},
		BackgroundColour: &options.RGBA{R: 27, G: 38, B: 54, A: 1},
		OnStartup: func(ctx context.Context) {
			if wailsRuntime.Environment(ctx).BuildType == "dev" {
				mainApp.Logger.SetLevel(logrus.DebugLevel) // 日志等级
			}
			mainApp.SetContext(ctx)
			event.SetContext(ctx)

			//适配小屏
			screens, _ := wailsRuntime.ScreenGetAll(ctx)
			for _, screen := range screens {
				if screen.IsCurrent {
					width := defaultWidth
					height := defaultHeight
					if width >= screen.Size.Width {
						width = screen.Size.Width * 4 / 5
					}
					if height >= screen.Size.Height {
						height = screen.Size.Height * 4 / 5
					}
					wailsRuntime.WindowSetSize(ctx, width, height)
				}
			}
		},
		Bind: []interface{}{
			mainApp,
			&status.StatusEnum{},
			&history2.HistoryEnum{},
			&status.StatusEnum{},
			&event.EventDetail{},
			osoperation.NewRuntime(mainApp),
			osoperation.NewPath(),
			httpx.NewBridge(mainApp),
			icp.NewBridge(mainApp),
			ip138.NewBridge(mainApp),
			fofa.NewBridge(mainApp),
			hunter.NewBridge(mainApp),
			quake.NewBridge(mainApp),
			gogoService.NewBridge(mainApp),
			shodan.NewBridge(mainApp),
			history.NewBridge(mainApp),
			wechat.NewBridge(mainApp),
			exportlog.NewBridge(mainApp),
			tianyancha.NewBridge(mainApp),
			aiqicha.NewBridge(mainApp),
		},
		//Debug: options.Debug{
		//	OpenInspectorOnStartup: true,
		//},
	}
	if err := wails.Run(opts); err != nil {
		mainApp.Logger.Info(err)
	}
}
