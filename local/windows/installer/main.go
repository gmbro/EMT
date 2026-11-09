// Build for Windows x64. The packager appends the allowlisted application ZIP.
package main

import (
	"archive/zip"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

func command(dir, program string, args ...string) error {
	cmd := exec.Command(program, args...)
	cmd.Dir = dir
	cmd.Stdin, cmd.Stdout, cmd.Stderr = os.Stdin, os.Stdout, os.Stderr
	return cmd.Run()
}

func extract(exe, root string) error {
	archive, err := zip.OpenReader(exe)
	if err != nil {
		return err
	}
	defer archive.Close()
	for _, entry := range archive.File {
		name, ok := strings.CutPrefix(entry.Name, "EMT-Qwen-Windows/")
		if !ok || !filepath.IsLocal(filepath.FromSlash(name)) {
			return errors.New("Invalid application archive")
		}
		target := filepath.Join(root, filepath.FromSlash(name))
		if err = os.MkdirAll(filepath.Dir(target), 0755); err != nil {
			return err
		}
		src, err := entry.Open()
		if err != nil {
			return err
		}
		dst, err := os.CreateTemp(filepath.Dir(target), ".install-*")
		if err != nil {
			src.Close()
			return err
		}
		_, err = io.Copy(dst, src)
		src.Close()
		closeErr := dst.Close()
		if err == nil {
			err = closeErr
		}
		if err == nil {
			err = os.Rename(dst.Name(), target)
		}
		if err != nil {
			os.Remove(dst.Name())
			return err
		}
	}
	return nil
}

func findPython() string {
	candidates := []string{filepath.Join(os.Getenv("LOCALAPPDATA"), "Programs", "Python", "Python312", "python.exe"), filepath.Join(os.Getenv("ProgramFiles"), "Python312", "python.exe")}
	if output, err := exec.Command("py", "-3.12", "-c", "import sys;print(sys.executable)").Output(); err == nil {
		candidates = append(candidates, strings.TrimSpace(string(output)))
	}
	if path, err := exec.LookPath("python"); err == nil && !strings.Contains(strings.ToLower(path), "windowsapps") {
		candidates = append(candidates, path)
	}
	for _, p := range candidates {
		if exec.Command(p, "-c", "import sys;assert sys.version_info[:2]==(3,12) and sys.maxsize>2**32").Run() == nil {
			return p
		}
	}
	return ""
}

func findNode() string {
	candidates := []string{filepath.Join(os.Getenv("ProgramFiles"), "nodejs", "node.exe")}
	if p, err := exec.LookPath("node"); err == nil {
		candidates = append(candidates, p)
	}
	for _, p := range candidates {
		if exec.Command(p, "-e", "process.exit(Number(process.versions.node.split('.')[0]) >= 22 ? 0 : 1)").Run() == nil {
			return p
		}
	}
	return ""
}

func dependency(find func() string, id, website string) (string, error) {
	if path := find(); path != "" {
		return path, nil
	}
	fmt.Println("Installing", id)
	if err := command("", "winget", "install", "--exact", "--id", id, "--source", "winget", "--accept-package-agreements", "--accept-source-agreements"); err != nil {
		return "", fmt.Errorf("%s 설치 실패 (%v). %s 에서 설치한 뒤 EMT-Setup.exe를 다시 여세요", id, err, website)
	}
	if path := find(); path != "" {
		return path, nil
	}
	return "", fmt.Errorf("%s 설치 후 EMT-Setup.exe를 다시 열어 주세요", id)
}

func install() error {
	root := filepath.Join(os.Getenv("LOCALAPPDATA"), "EMT", "app")
	fmt.Println("EMT Windows 설치 · 모델 다운로드에 15GB 이상의 여유 공간이 필요합니다.")
	exe, err := os.Executable()
	if err != nil {
		return err
	}
	if err = extract(exe, root); err != nil {
		return err
	}
	python, err := dependency(findPython, "Python.Python.3.12", "https://www.python.org/downloads/windows/")
	if err != nil {
		return err
	}
	node, err := dependency(findNode, "OpenJS.NodeJS.LTS", "https://nodejs.org/en/download")
	if err != nil {
		return err
	}
	os.Setenv("PATH", filepath.Dir(node)+string(os.PathListSeparator)+os.Getenv("PATH"))
	os.Setenv("PYTHONUTF8", "1")
	if err = command(root, python, "local/windows/setup.py"); err != nil {
		return err
	}
	// Use variables for all paths so spaces and quotes never become PowerShell code.
	os.Setenv("EMT_APP_DIR", root)
	os.Setenv("EMT_NODE", node)
	shortcut := "$w=New-Object -ComObject WScript.Shell; $s=$w.CreateShortcut((Join-Path ([Environment]::GetFolderPath('Programs')) 'EMT.lnk')); $s.TargetPath=$env:EMT_NODE; $s.Arguments='local/qwen/run.mjs'; $s.WorkingDirectory=$env:EMT_APP_DIR; $s.Save()"
	if err = command(root, "powershell.exe", "-NoProfile", "-NonInteractive", "-Command", "$ErrorActionPreference='Stop';"+shortcut); err != nil {
		fmt.Println("바로가기 생성 실패. 설치 폴더의 실행.cmd를 사용하세요:", root)
	}
	fmt.Println("설치 완료. 다음에는 시작 메뉴에서 EMT를 여세요.")
	return command(root, node, "local/qwen/run.mjs")
}
func main() {
	if err := install(); err != nil {
		fmt.Fprintln(os.Stderr, "설치 또는 실행 중 오류:", err)
		fmt.Print("Enter 키를 눌러 닫으세요.")
		fmt.Scanln()
		os.Exit(1)
	}
}
