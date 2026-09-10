import assert from "node:assert/strict";
import { access, readFile, readdir } from "node:fs/promises";
import { basename, relative, resolve } from "node:path";
import { describe, it } from "node:test";

import {
  compareTopLevelNavigationLabels,
  conventionalDocumentationFiles,
  documentationSources,
  getDocumentationSourceByKey,
  getDocumentationSourceForVirtualPath,
  getExpectedDocumentationPaths,
  getFileNavigationLabel,
  getFolderNavigationLabel,
  isRepositoryDocumentationPath,
  repositoryNavigationOrder,
  shouldOpenNavigationFolder,
  toRepositoryDocumentationPath,
  toRepositoryDocumentationUrl,
  toVirtualDocumentationPath,
  type DocumentationSource,
} from "../documentation-sources.ts";

const workspaceRoot = resolve(import.meta.dirname, "../../../../..");
const docsAppRoot = resolve(workspaceRoot, "apps/docs-web");

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function listMarkdownFiles(directory: string): Promise<string[]> {
  if (!(await pathExists(directory))) return [];

  const files: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const entryPath = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listMarkdownFiles(entryPath)));
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      files.push(entryPath);
    }
  }

  return files;
}

function sourceRoot(source: DocumentationSource): string {
  return resolve(docsAppRoot, source.collectionDirectory);
}

describe("documentation ownership registry", () => {
  it("registers every audited repository, application, and package", () => {
    assert.deepEqual(
      documentationSources.map(({ key, route, ownerType }) => ({
        key,
        route,
        ownerType,
      })),
      [
        {
          key: "rtq-content",
          route: "rtq-content",
          ownerType: "repository",
        },
        {
          key: "rtq-content-assets",
          route: "rtq-content/packages/assets",
          ownerType: "package",
        },
        {
          key: "rtq-content-papers",
          route: "rtq-content/packages/papers",
          ownerType: "package",
        },
        { key: "rtq-env", route: "rtq-env", ownerType: "repository" },
        {
          key: "rtq-review",
          route: "rtq-review",
          ownerType: "repository",
        },
        {
          key: "rtq-review-docs-web",
          route: "rtq-review/apps/docs-web",
          ownerType: "app",
        },
        {
          key: "rtq-review-review-api",
          route: "rtq-review/apps/review-api",
          ownerType: "app",
        },
        {
          key: "rtq-review-review-legacy-gatsby-web",
          route: "rtq-review/apps/review-legacy-gatsby-web",
          ownerType: "app",
        },
        {
          key: "rtq-review-review-question-viewer-web",
          route: "rtq-review/apps/review-question-viewer-web",
          ownerType: "app",
        },
        {
          key: "rtq-review-review-tag-web",
          route: "rtq-review/apps/review-tag-web",
          ownerType: "app",
        },
        {
          key: "rtq-review-review-markdown-web",
          route: "rtq-review/apps/review-markdown-web",
          ownerType: "app",
        },
        {
          key: "rtq-review-repository-paths",
          route: "rtq-review/packages/repository-paths",
          ownerType: "package",
        },
        { key: "rtq-web", route: "rtq-web", ownerType: "repository" },
        {
          key: "rtq-web-web",
          route: "rtq-web/apps/web",
          ownerType: "app",
        },
        {
          key: "rtq-web-feature-config",
          route: "rtq-web/packages/feature-config",
          ownerType: "package",
        },
      ],
    );
  });

  it("uses only the conventional README and docs allowlist", () => {
    for (const source of documentationSources) {
      assert.deepEqual(source.files, conventionalDocumentationFiles);
    }

    const papers = getDocumentationSourceByKey("rtq-content-papers");
    assert.ok(papers);
    assert.equal(
      isRepositoryDocumentationPath(
        papers,
        "packages/papers/docs/ai/answers/README.md",
      ),
      true,
    );
    assert.equal(
      isRepositoryDocumentationPath(papers, "packages/papers/old-docs/a.md"),
      false,
    );
    assert.equal(
      isRepositoryDocumentationPath(papers, "packages/papers/prompts/a.md"),
      false,
    );
    assert.equal(
      isRepositoryDocumentationPath(
        papers,
        "packages/papers/__dead-pool__/docs/free-papers/analysis/final.md",
      ),
      false,
    );

    const reviewApi = getDocumentationSourceByKey("rtq-review-review-api");
    assert.ok(reviewApi);
    assert.equal(
      isRepositoryDocumentationPath(reviewApi, "apps/review-api/commands.md"),
      false,
    );
    assert.equal(
      isRepositoryDocumentationPath(reviewApi, "apps/review-api/AGENTS.md"),
      false,
    );
  });

  it("reads representative content directly from sibling working trees", async () => {
    const cases = [
      {
        sourceKey: "rtq-env",
        expectedRoot: resolve(workspaceRoot, "../rtq-env"),
        file: "docs/environment-manifest.md",
        heading: "# Environment Manifest",
      },
      {
        sourceKey: "rtq-content-assets",
        expectedRoot: resolve(workspaceRoot, "../rtq-content/packages/assets"),
        file: "docs/architecture/paper-assets.md",
        heading: "# Paper Assets Architecture",
      },
      {
        sourceKey: "rtq-web-web",
        expectedRoot: resolve(workspaceRoot, "../rtq-web/apps/web"),
        file: "docs/architecture/frontend/routing.md",
        heading: "# Routing Architecture",
      },
    ] as const;

    for (const testCase of cases) {
      const source = getDocumentationSourceByKey(testCase.sourceKey);
      assert.ok(source);
      assert.equal(sourceRoot(source), testCase.expectedRoot);
      assert.match(
        await readFile(resolve(sourceRoot(source), testCase.file), "utf8"),
        new RegExp(`^${testCase.heading}`, "m"),
      );
    }
  });

  it("loads multiple independently configured owners from one repository", async () => {
    const repository = getDocumentationSourceByKey("rtq-content");
    const assets = getDocumentationSourceByKey("rtq-content-assets");
    assert.ok(repository);
    assert.ok(assets);
    assert.equal(repository.repository.name, assets.repository.name);
    assert.notEqual(sourceRoot(repository), sourceRoot(assets));
    assert.match(
      await readFile(resolve(sourceRoot(repository), "README.md"), "utf8"),
      /^# RTQ content/m,
    );
    assert.match(
      await readFile(
        resolve(sourceRoot(assets), "docs/architecture/paper-assets.md"),
        "utf8",
      ),
      /^# Paper Assets Architecture/m,
    );
  });

  it("derives the current allowlisted inventory without a snapshot count", async () => {
    let readmeCount = 0;
    let docsCount = 0;

    for (const source of documentationSources) {
      const root = sourceRoot(source);
      if (await pathExists(resolve(root, "README.md"))) {
        readmeCount += 1;
        assert.equal(
          isRepositoryDocumentationPath(
            source,
            [source.repositoryDirectory, "README.md"].filter(Boolean).join("/"),
          ),
          true,
        );
      }

      const docs = await listMarkdownFiles(resolve(root, "docs"));
      docsCount += docs.length;
      for (const file of docs) {
        assert.equal(
          isRepositoryDocumentationPath(
            source,
            [source.repositoryDirectory, relative(root, file)]
              .filter(Boolean)
              .join("/"),
          ),
          true,
        );
      }
    }

    assert.ok(readmeCount > 0);
    assert.ok(docsCount > 0);
  });

  it("reports missing conventional paths without broadening discovery", async () => {
    const missing: string[] = [];

    for (const source of documentationSources) {
      for (const expectedPath of getExpectedDocumentationPaths(source)) {
        const relativeToOwner = expectedPath
          .split("/")
          .slice(source.repositoryDirectory.split("/").filter(Boolean).length)
          .join("/");
        if (!(await pathExists(resolve(sourceRoot(source), relativeToOwner)))) {
          missing.push(`${source.repository.name}/${expectedPath}`);
        }
      }
    }

    assert.deepEqual(missing, [
      "rtq-content/docs",
      "rtq-review/apps/review-api/docs",
      "rtq-review/apps/review-legacy-gatsby-web/docs",
      "rtq-review/apps/review-question-viewer-web/docs",
      "rtq-review/apps/review-tag-web/docs",
      "rtq-review/apps/review-markdown-web/docs",
      "rtq-review/packages/repository-paths/README.md",
      "rtq-review/packages/repository-paths/docs",
      "rtq-web/docs",
      "rtq-web/packages/feature-config/docs",
    ]);
  });
});

describe("documentation routes and navigation", () => {
  it("uses the most specific owner for nested virtual paths", () => {
    const reviewTag = getDocumentationSourceByKey("rtq-review-review-tag-web");
    assert.ok(reviewTag);
    assert.equal(
      getDocumentationSourceForVirtualPath(
        "rtq-review/apps/review-tag-web/README.md",
      ),
      reviewTag,
    );
    assert.equal(
      toVirtualDocumentationPath(reviewTag, "README.md"),
      "rtq-review/apps/review-tag-web/README.md",
    );
  });

  it("preserves repository paths and source links across repositories", () => {
    const assets = getDocumentationSourceByKey("rtq-content-assets");
    assert.ok(assets);
    const virtualPath = toVirtualDocumentationPath(
      assets,
      "docs/architecture/paper-assets.md",
    );

    assert.equal(
      toRepositoryDocumentationPath(assets, virtualPath),
      "packages/assets/docs/architecture/paper-assets.md",
    );
    assert.equal(
      toRepositoryDocumentationUrl(assets, virtualPath),
      "https://github.com/Read-The-Question/rtq-content/blob/develop/packages/assets/docs/architecture/paper-assets.md",
    );

    const environment = getDocumentationSourceByKey("rtq-env");
    assert.ok(environment);
    assert.equal(
      toRepositoryDocumentationPath(
        environment,
        "rtq-env/docs/environment-manifest.md",
      ),
      "docs/environment-manifest.md",
    );
  });

  it("preserves source names in navigation labels", () => {
    assert.equal(getFolderNavigationLabel("rtq-content"), "rtq-content");
    assert.equal(getFolderNavigationLabel("rtq-content/packages"), "packages");
    assert.equal(
      getFolderNavigationLabel("rtq-review/apps/review-tag-web"),
      "review-tag-web",
    );
    assert.equal(
      getFolderNavigationLabel("rtq-review/apps/docs-web/docs"),
      "docs",
    );
    assert.equal(
      getFolderNavigationLabel(
        "rtq-content/packages/papers/docs/ai/tag-style-guides",
      ),
      "tag-style-guides",
    );
    assert.equal(
      getFileNavigationLabel("rtq-review/README.md", "RTQ review"),
      "README",
    );
    assert.equal(
      getFileNavigationLabel(
        "docs/architecture/long-routing-guide.md",
        "Long Routing Guide",
      ),
      "long-routing-guide",
    );
  });

  it("orders repositories and opens only the structural hierarchy", () => {
    assert.deepEqual(repositoryNavigationOrder, [
      "rtq-web",
      "rtq-content",
      "rtq-env",
      "rtq-review",
    ]);
    assert.deepEqual(
      ["rtq-review", "rtq-env", "rtq-web", "rtq-content"].sort(
        compareTopLevelNavigationLabels,
      ),
      repositoryNavigationOrder,
    );

    assert.equal(shouldOpenNavigationFolder("rtq-web"), true);
    assert.equal(shouldOpenNavigationFolder("rtq-web/apps"), true);
    assert.equal(shouldOpenNavigationFolder("rtq-web/apps/web"), true);
    assert.equal(shouldOpenNavigationFolder("rtq-review/packages"), true);
    assert.equal(
      shouldOpenNavigationFolder("rtq-review/packages/repository-paths"),
      true,
    );
    assert.equal(shouldOpenNavigationFolder("rtq-env/docs"), false);
    assert.equal(
      shouldOpenNavigationFolder("rtq-web/apps/web/docs/architecture"),
      false,
    );
  });
});

describe("RTQ Docs application surface", () => {
  it("redirects both entry routes to the RTQ Web README", async () => {
    const [rootPage, docsPage, shared] = await Promise.all([
      readFile(resolve(docsAppRoot, "src/app/(home)/page.tsx"), "utf8"),
      readFile(
        resolve(docsAppRoot, "src/app/docs/[[...slug]]/page.tsx"),
        "utf8",
      ),
      import("../shared.ts"),
    ]);

    assert.equal(shared.defaultDocumentRoute, "/docs/rtq-web/README");
    assert.match(rootPage, /redirect\(defaultDocumentRoute\)/);
    assert.match(
      docsPage,
      /if \(!params\.slug\) redirect\(defaultDocumentRoute\)/,
    );
    assert.doesNotMatch(docsPage, /Select a repository/);
    await access(resolve(workspaceRoot, "../rtq-web/README.md"));
  });

  it("retains only the required application routes", async () => {
    const retainedRoutes = [
      "src/app/(home)/page.tsx",
      "src/app/docs/[[...slug]]/page.tsx",
      "src/app/api/search/route.ts",
    ];
    const removedRoutes = [
      "src/app/llms.txt/route.ts",
      "src/app/llms-full.txt/route.ts",
      "src/app/llms.mdx/docs/[[...slug]]/route.ts",
      "src/app/og/docs/[...slug]/route.tsx",
      "proxy.ts",
    ];

    await Promise.all(
      retainedRoutes.map((route) => access(resolve(docsAppRoot, route))),
    );
    await Promise.all(
      removedRoutes.map((route) =>
        assert.rejects(access(resolve(docsAppRoot, route))),
      ),
    );
  });

  it("uses the supplied Fumadocs navigation and page presentation", async () => {
    const [docsLayout, docsPage, searchRoute, sourceModule] = await Promise.all(
      [
        readFile(resolve(docsAppRoot, "src/app/docs/layout.tsx"), "utf8"),
        readFile(
          resolve(docsAppRoot, "src/app/docs/[[...slug]]/page.tsx"),
          "utf8",
        ),
        readFile(resolve(docsAppRoot, "src/app/api/search/route.ts"), "utf8"),
        readFile(resolve(docsAppRoot, "src/lib/source.ts"), "utf8"),
      ],
    );

    assert.match(docsLayout, /tree=\{source\.getPageTree\(\)\}/);
    assert.match(docsPage, /<DocsPage toc=\{page\.data\.toc\}/);
    assert.match(docsPage, /<DocsBody>/);
    assert.match(docsPage, /<EditOnGitHub href=\{getPageGitHubUrl\(page\)\}>/);
    assert.match(docsPage, /a: createRelativeLink\(source, page\)/);
    assert.match(searchRoute, /createFromSource\(source\)/);
    assert.match(sourceModule, /defaultOpen: shouldOpenNavigationFolder/);
    assert.match(sourceModule, /compareTopLevelNavigationLabels/);
  });

  it("configures a wider responsive desktop sidebar without replacing it", async () => {
    const [docsLayout, globalCss] = await Promise.all([
      readFile(resolve(docsAppRoot, "src/app/docs/layout.tsx"), "utf8"),
      readFile(resolve(docsAppRoot, "src/app/global.css"), "utf8"),
    ]);

    assert.match(docsLayout, /className: "rtq-docs-layout"/);
    assert.match(docsLayout, /sidebar=\{\{ defaultOpenLevel: 0 \}\}/);
    assert.match(globalCss, /@media \(width >= 48rem\)/);
    assert.match(globalCss, /--fd-sidebar-width: clamp\(300px, 25vw, 440px\)/);
    assert.doesNotMatch(
      globalCss,
      /@media \(width < 48rem\)[\s\S]*--fd-sidebar-width/,
    );
  });

  it("identifies the application as an internal documentation surface", async () => {
    const [rootLayout, readme] = await Promise.all([
      readFile(resolve(docsAppRoot, "src/app/layout.tsx"), "utf8"),
      readFile(resolve(docsAppRoot, "README.md"), "utf8"),
    ]);

    assert.match(rootLayout, /Internal documentation for RTQ/);
    assert.match(readme, /Internal Fumadocs application/);
  });

  it("configures native cross-repository live reload", async () => {
    const [nextConfig, packageJsonText, integrationCheck] = await Promise.all([
      readFile(resolve(docsAppRoot, "next.config.mjs"), "utf8"),
      readFile(resolve(docsAppRoot, "package.json"), "utf8"),
      readFile(
        resolve(docsAppRoot, "src/lib/__tests__/live-reload.integration.mjs"),
        "utf8",
      ),
    ]);
    const packageJson = JSON.parse(packageJsonText) as {
      scripts: Record<string, string>;
    };

    assert.match(nextConfig, /turbopack:\s*\{/);
    assert.match(nextConfig, /root: repositoriesRoot/);
    assert.equal(packageJson.scripts.dev, "next dev");
    assert.equal(packageJson.scripts.build, "next build --webpack");
    assert.equal(
      packageJson.scripts["test:live-reload"],
      "node src/lib/__tests__/live-reload.integration.mjs",
    );
    assert.match(integrationCheck, /\.\.\/\.\.\/\.\.\/rtq-env/);
    assert.match(integrationCheck, /T6-ADDED/);
    assert.match(integrationCheck, /T6-CHANGED/);
    assert.match(integrationCheck, /await rename\(initialFile, renamedFile\)/);
    assert.match(integrationCheck, /await rm\(renamedFile\)/);
  });

  it("does not declare unused scaffold utilities as dependencies", async () => {
    const packageJson = JSON.parse(
      await readFile(resolve(docsAppRoot, "package.json"), "utf8"),
    ) as { dependencies: Record<string, string> };

    assert.equal("cnfast" in packageJson.dependencies, false);
    assert.equal("lucide-react" in packageJson.dependencies, false);
  });

  it("keeps all test cases inside __tests__", () => {
    assert.equal(basename(import.meta.dirname), "__tests__");
  });
});
