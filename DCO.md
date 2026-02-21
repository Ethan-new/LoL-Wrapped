# Developer Certificate of Origin

This project uses the [Developer Certificate of Origin (DCO)](https://developercertificate.org/) to certify that contributors have the right to submit their contributions.

## Signing your work

Every commit in a pull request **must** be signed off. Add `Signed-off-by` to your commit message:

```
Signed-off-by: Your Name <your.email@example.com>
```

The easiest way is to use `-s` when committing:

```bash
git commit -s -m "Your commit message"
```

Git will use your `user.name` and `user.email` config. Ensure they are set:

```bash
git config user.name "Your Name"
git config user.email "your.email@example.com"
```

## DCO 1.1

By making a contribution to this project, you certify that:

(a) The contribution was created in whole or in part by you and you have the right to submit it under the open source license indicated in the file; or

(b) The contribution is based upon previous work that, to the best of your knowledge, is covered under an appropriate open source license and you have the right under that license to submit that work with modifications, whether created in whole or in part by you, under the same open source license (unless you are permitted to submit under a different license), as indicated in the file; or

(c) The contribution was provided directly to you by some other person who certified (a), (b) or (c) and you have not modified it.

(d) You understand and agree that this project and the contribution are public and that a record of the contribution (including all personal information you submit with it, including your sign-off) is maintained indefinitely and may be redistributed consistent with this project or the open source license(s) involved.

## Enforcement

The CI workflow verifies that all commits in a pull request are signed off. PRs with unsigned commits will not pass. Maintainers may also use the [DCO bot](https://github.com/apps/dco) as an alternative.
