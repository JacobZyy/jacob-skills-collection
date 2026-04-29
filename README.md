# jacob-skills-collection

个人 AI 相关工具合集仓库。

## 简介

这是一个收集和整理我个人开发的 AI 相关工具、脚本和配置的仓库。

## 内容

（待补充）

## 双远程推送

本仓库同时关联 GitHub 和 GitLab，push 时自动同步到两个远端：

- GitHub: `https://github.com/JacobZyy/jacob-skills-collection`
- GitLab: `https://gitlab.zhuanspirit.com/zhayang/jacob-open-source`

## GitLab 代理开关

公司内网访问 GitLab 需要代理时，使用以下命令：

```bash
# 查看代理状态
./scripts/gitlab-proxy.sh status

# 开启代理（挂到 127.0.0.1:12639）
./scripts/gitlab-proxy.sh on

# 关闭代理
./scripts/gitlab-proxy.sh off
```

## 使用

```bash
git clone https://github.com/JacobZyy/jacob-skills-collection.git
```
