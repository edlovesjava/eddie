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

## Why your push was denied

macOS Keychain (the default HTTPS credential helper) stores **one** GitHub
credential for all of `github.com`, so with HTTPS remotes every repo pushes
as whichever account signed in last. The SSH-alias setup above sidesteps
that completely. If you prefer staying on HTTPS, install
[Git Credential Manager](https://github.com/git-ecosystem/git-credential-manager)
(`brew install git-credential-manager`), which supports multiple GitHub
accounts and prompts per repo — the folder-based identity in step 4 still
applies either way.
