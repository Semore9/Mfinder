//go:build windows
// +build windows

package shodan

import (
	"syscall"
)

// WindowsScreen Windows系统原生API实现
type WindowsScreen struct{}

var (
	user32               = syscall.NewLazyDLL("user32.dll")
	procGetSystemMetrics = user32.NewProc("GetSystemMetrics")
)

const (
	SM_CXSCREEN = 0 // 屏幕宽度
	SM_CYSCREEN = 1 // 屏幕高度
)

// GetScreenSize 使用Windows API获取屏幕分辨率
func (w *WindowsScreen) GetScreenSize() (int, int) {
	width, _, _ := procGetSystemMetrics.Call(uintptr(SM_CXSCREEN))
	height, _, _ := procGetSystemMetrics.Call(uintptr(SM_CYSCREEN))
	
	// 如果系统调用失败，返回常见默认值
	if width == 0 || height == 0 {
		return 1920, 1080
	}
	
	return int(width), int(height)
}

// getScreen 返回Windows原生实现
func getScreen() Screen {
	return &WindowsScreen{}
}