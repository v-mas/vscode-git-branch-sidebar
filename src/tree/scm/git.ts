import * as vscode from 'vscode';
import { GitExtension, Repository, API } from '../../typings/git';
import { promisify } from 'util';
import * as child_process from 'child_process';
import * as path from 'path';
import { BehaviorSubject, Observable } from 'rxjs';
import { Branch } from './branch';

const exec = promisify(child_process.exec);

export class Git {
    private gitApi?: API;

    private repoStateChanges: vscode.Disposable[] = [];

    private repos: Repository[] = [];
    private $repos: BehaviorSubject<Repository[]>;

    private readonly validBranchName: RegExp = /^(?!\/|.*(?:[/.]\.|\/\/|@\{|\\))[^\040\177 ~^:?*[]+(?<!\.lock)(?<![/.])$/;

    constructor() {
        this.$repos = new BehaviorSubject<Repository[]>(this.repos);
        this.getRepos();
    }

    private getApi(): API|null {
        if (this.gitApi) {
            return this.gitApi;
        }
        const gitContainer = vscode.extensions.getExtension<GitExtension>('vscode.git');
        if (gitContainer) {
            const gitExtension = gitContainer.exports;
            const gitApi = gitExtension.getAPI(1);
            this.gitApi = gitApi;
            gitApi.onDidChangeState(() => {
                this.refresh();
            });
            return this.gitApi;
        }
        return null;
    }

    private getRepos() {
        let api = this.getApi();
        this.repoStateChanges.forEach(listener => listener.dispose());
        this.repoStateChanges = [];
        if (api) {
            this.repos = api.repositories;
            this.$repos.next(this.repos);
            this.repoStateChanges = this.repos.map(
                (repo) => {
                    return repo.state.onDidChange(() => {
                        this.refresh();
                    });
                }
            );
        }
    }

    public refresh(): any {
        this.getRepos();
    }

    public getRepositories(): Observable<Repository[]> {
        return this.$repos;
    }

    public async getBranches(repo: Repository): Promise<Branch[]> {
        const path = repo.rootUri.fsPath;
        if (!path) {
            return [];
        }
        const {stdout} = await exec(
            'git branch',
            {
                cwd: path
            }
        );
        const branchNames = stdout.split(/\n/g).filter(branch => !!branch);
        const branches: Branch[] = branchNames.map((branch) => {
            const isStarred = branch.indexOf('*') === 0;
            const branchName = isStarred ? branch.slice(1).trim() : branch.trim();
            return {
                repo,
                branchName,
                selected: isStarred
            };
        });
        return branches;
    }

    public async checkoutBranch(branch: Branch): Promise<void> {
        const path = branch.repo.rootUri.fsPath;
        if (!path) {
            return;
        }
        await exec(
            `git checkout ${branch.branchName}`,
            {
                cwd: path
            }
        );

        this.refresh();
    }
    public async deleteBranch(branch: Branch): Promise<void> {
        const path = branch.repo.rootUri.fsPath;
        if (!path) {
            return;
        }
        await exec(
            `git branch -D ${branch.branchName}`,
            {
                cwd: path
            }
        );

        this.refresh();
    }
    public async renameBranch(branch: Branch, newName: string): Promise<void> {
        if (!this.validBranchName.test(newName)) {
            vscode.window.showErrorMessage('Branch name is not valid');
        }
        const path = branch.repo.rootUri.fsPath;
        if (!path) {
            return;
        }
        let cmd: string = `git branch -m ${branch.branchName} ${newName}`;
        if (branch.selected) {
            cmd = `git branch -m ${newName}`;
        }
        await exec(
            cmd,
            {
                cwd: path
            }
        );

        this.refresh();
    }
}