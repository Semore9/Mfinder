//go:build !windows

package gogoscan

import (
	"math"
	"syscall"
)

func fdSoftLimit() int {
	var r syscall.Rlimit
	if err := syscall.Getrlimit(syscall.RLIMIT_NOFILE, &r); err != nil {
		return 0
	}
	if r.Cur <= 0 || r.Cur > math.MaxInt32 {
		return 0
	}
	return int(r.Cur)
}

func fdAwareThreadCap() int {
	fd := fdSoftLimit()
	if fd <= 0 {
		return 0
	}
	cap := fd / 4
	if cap < 8 {
		cap = 8
	}
	return cap
}
