package shodan

// Screen 屏幕操作接口
type Screen interface {
	GetScreenSize() (int, int)
}

// GetScreen 获取屏幕操作实例
func GetScreen() Screen {
	return getScreen()
}