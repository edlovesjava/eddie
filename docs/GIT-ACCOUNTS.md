# Multiple GitHub accounts (work / personal / school)

Eddie's Push button runs plain `git push` in the repo you're editing, with
whatever identity and credentials your local git resolves for that repo. So
"push as a different account per repo" is configured once in git itself —
after that, Eddie (and your terminal, and every other tool) picks the right
account automatically. The git panel shows the active identity and push
remote (`as Name <email> → git@github-personal:…`) so you can check before
pushing.

The recipe below switches accounts **by folder**, which is the setup that
stays out of your way: put a repo in the right folder and everything else
follows.

## 1. One folder per account

```
~/code/personal/
~/code/work/
~/code/school/
```

## 2. One SSH key per account

```bash
ssh-keygen -t ed25519 -f ~/.ssh/id_ed25519_personal -C "personal"
ssh-keygen -t ed25519 -f ~/.ssh/id_ed25519_work     -C "work"
ssh-keygen -t ed25519 -f ~/.ssh/id_ed25519_school   -C "school"
```

Add each **public** key (`.pub` file) to the matching GitHub account under
Settings → SSH and GPG keys.

## 3. Host aliases in `~/.ssh/config`

```
Host github-personal
    HostName github.com
    User git
    IdentityFile ~/.ssh/id_ed25519_personal
    IdentitiesOnly yes

Host github-work
    HostName github.com
    User git
    IdentityFile ~/.ssh/id_ed25519_work
    IdentitiesOnly yes

Host github-school
    HostName github.com
    User git
    IdentityFile ~/.ssh/id_ed25519_school
    IdentitiesOnly yes
```

`IdentitiesOnly yes` matters — it stops ssh from offering every key in your
agent, which is exactly how the wrong account gets used.

## 4. Per-folder identity in `~/.gitconfig`

```ini
[user]  # default = personal
    name = Ed Wentworth
    email = ed.wentworth@gmail.com

[includeIf "gitdir:~/code/work/"]
    path = ~/.gitconfig-work
[includeIf "gitdir:~/code/school/"]
    path = ~/.gitconfig-school
```

`~/.gitconfig-work`:

```ini
[user]
    name = Ed Wentworth
    email = ed@yourcompany.com
[url "git@github-work:"]
    insteadOf = git@github.com:
    insteadOf = https://github.com/
```

`~/.gitconfig-school` is the same shape with the school email and
`git@github-school:`.

The `insteadOf` rewrites are the trick: inside `~/code/work/`, any repo whose
remote is a normal `github.com` URL (HTTPS or SSH) transparently pushes
through the `github-work` alias — the work key — with the work email on
commits. You can `git clone` with the URL GitHub shows you and never think
about it again.

## 5. Move existing repos and verify

Move each repo into its folder, then check what Eddie's panel will show:

```bash
cd ~/code/work/some-repo
git config user.email          # work email?
ssh -T git@github-work         # "Hi <work-account>!"
```

## Adapting an existing `gh`-based config

If your `~/.gitconfig` already routes github.com credentials through the
GitHub CLI —

```ini
[credential "https://github.com"]
    helper = 
    helper = !/usr/local/bin/gh auth git-credential
```

— then HTTPS pushes authenticate as whichever account is *active* in `gh`
(one at a time for all of github.com; the blank `helper =` line is
intentional — it stops osxkeychain from also answering). You don't have to
rip that out: leave `gh` as the auth for your default/most-used account, and
carve out the other accounts by folder with `includeIf` + SSH aliases as
above. Repos in the carved-out folders push over SSH with the right key
(the `insteadOf` rewrite catches their HTTPS remotes automatically); every
other repo keeps using `gh` exactly as before. Only the non-default accounts
need SSH keys.

Gotchas: `includeIf "gitdir:~/code/personal/"` needs the trailing slash, and
it matches the repo's real path — a repo reached through a symlink won't
match.

Two ssh_config traps (both found the hard way):

- **`IdentityFile` under `Host *` leaks into every alias.** Unlike most ssh
  options (first match wins), `IdentityFile` *accumulates* across all
  matching blocks — a global work key gets offered first and GitHub happily
  authenticates you as the wrong account, even with `IdentitiesOnly yes`.
  Keep each `IdentityFile` inside a specific `Host` block, never `Host *`.
- **SSH over port 443.** If your `Host github.com` block uses
  `Hostname ssh.github.com` / `Port 443` (common where a network blocks
  port 22), give the aliases the same `Hostname`/`Port` — otherwise they
  hang on that network while the work block sails through.

## Why your push was denied

macOS Keychain (the default HTTPS credential helper) stores **one** GitHub
credential for all of `github.com`, so with HTTPS remotes every repo pushes
as whichever account signed in last. The SSH-alias setup above sidesteps
that completely. If you prefer staying on HTTPS, install
[Git Credential Manager](https://github.com/git-ecosystem/git-credential-manager)
(`brew install git-credential-manager`), which supports multiple GitHub
accounts and prompts per repo — the folder-based identity in step 4 still
applies either way.
