//go:build darwin
// +build darwin

package shodan

import "os/exec"
import "strconv"
import "strings"

// DarwinScreen macOS系统实现
type DarwinScreen struct{}

// GetScreenSize 使用system_profiler获取屏幕分辨率
func (d *DarwinScreen) GetScreenSize() (int, int) {
	// 使用system_profiler获取显示器信息
	cmd := exec.Command("system_profiler", "SPDisplaysDataType")
	output, err := cmd.Output()
	if err != nil {
		// 如果命令失败，返回MacBook常见分辨率
		return 1440, 900
	}
	
	// 解析输出获取分辨率
	lines := strings.Split(string(output), "\n")
	for _, line := range lines {
		if strings.Contains(line, "Resolution") {
			// 格式: Resolution: 1920 x 1080
			fields := strings.Fields(line)
			if len(fields) >= 4 {
				if width, err := strconv.Atoi(fields[1]); err == nil {
					if height, err := strconv.Atoi(fields[3]); err == nil {
						return width, height
					}
				}
			}
		}
	}
	
	// 解析失败，返回MacBook常见分辨率
	return 1440, 900
}

// getScreen 返回macOS实现
func getScreen() Screen {
	return &DarwinScreen{}
}