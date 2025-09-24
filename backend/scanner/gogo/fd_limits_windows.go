//go:build windows

package gogoscan

func fdSoftLimit() int {
	return 0
}

func fdAwareThreadCap() int {
	return 0
}
