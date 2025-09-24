//go:build !windows && !darwin
// +build !windows,!darwin

package shodan

// FallbackScreen fallback实现的屏幕操作
type FallbackScreen struct{}

// GetScreenSize 返回常见的屏幕分辨率默认值
func (f *FallbackScreen) GetScreenSize() (int, int) {
	// 使用常见的屏幕分辨率作为默认值
	// 1920x1080 - Full HD标准
	// 1366x768 - 常见笔记本分辨率  
	// 1440x900 - MacBook常见分辨率
	return 1920, 1080
}

// getScreen 返回fallback实现
func getScreen() Screen {
	return &FallbackScreen{}
}