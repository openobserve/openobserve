import { describe, expect, it, beforeEach, vi, afterEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";
import { Notify } from "quasar";
import AddDashboardFromGitHub from "./AddDashboardFromGitHub.vue";
import store from "@/test/unit/helpers/store";
import i18n from "@/locales";

// Mock dashboards service
vi.mock("@/services/dashboards", () => ({
  default: {
    list_Folders: vi.fn(),
    list: vi.fn(),
    create: vi.fn(),
    delete: vi.fn(),
  },
}));

// Mock AddFolder component
vi.mock("@/components/dashboards/AddFolder.vue", () => ({
  default: {
    name: "AddFolder",
    template: '<div class="add-folder-mock"></div>',
    emits: ["update:modelValue"],
  },
}));

// Mock global fetch
const mockFetch = vi.fn();

// Helper to generate S3 ListObjectsV2 XML for folder listing (CommonPrefixes)
const s3FolderListXml = (folders: string[]): string => {
  const prefixes = folders
    .map((f) => `  <CommonPrefixes><Prefix>dashboards/${f}/</Prefix></CommonPrefixes>`)
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">\n${prefixes}\n</ListBucketResult>`;
};

// Helper to generate S3 ListObjectsV2 XML for file listing (Contents/Key)
const s3FileListXml = (folderPath: string, files: string[]): string => {
  const keys = files
    .map((f) => `  <Contents><Key>dashboards/${folderPath}/${f}</Key></Contents>`)
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">\n${keys}\n</ListBucketResult>`;
};

installQuasar({ plugins: [Notify] });

import dashboardsService from "@/services/dashboards";

describe("AddDashboardFromGitHub Component", () => {
  let wrapper: any;

  const mockS3Folders = ["aws", "nginx", "kubernetes", ".github"];

  const mockFolderList = {
    data: {
      list: [
        { folderId: "default", name: "default" },
        { folderId: "folder-1", name: "Folder 1" },
      ],
    },
  };

  const createWrapper = (props = {}) => {
    return mount(AddDashboardFromGitHub, {
      props: {
        modelValue: true,
        ...props,
      },
      global: {
        plugins: [i18n, store],
        stubs: {
          "q-dialog": {
            template: '<div class="q-dialog"><slot /></div>',
            props: ["modelValue"],
          },
          "q-card": {
            template: '<div class="q-card"><slot /></div>',
          },
          "q-card-section": {
            template: '<div class="q-card-section"><slot /></div>',
          },
          "q-card-actions": {
            template: '<div class="q-card-actions"><slot /></div>',
          },
          "q-separator": {
            template: '<hr class="q-separator" />',
          },
          "q-btn": {
            template:
              '<button @click="$emit(\'click\')" :data-test="$attrs[\'data-test\']" :disabled="$attrs.disable"><slot />{{ $attrs.label }}</button>',
            emits: ["click"],
          },
          "q-spinner": {
            template: '<div class="q-spinner"></div>',
          },
          "q-icon": {
            template: '<span class="q-icon">{{ $attrs.name }}</span>',
          },
          "q-input": {
            template:
              '<input :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" :data-test="$attrs[\'data-test\']" />',
            props: ["modelValue"],
            emits: ["update:modelValue"],
          },
          "q-list": {
            template: '<ul class="q-list"><slot /></ul>',
          },
          "q-item": {
            template:
              '<li class="q-item" @click="$emit(\'click\')" :data-test="$attrs[\'data-test\']"><slot /></li>',
            emits: ["click"],
          },
          "q-item-section": {
            template: '<div class="q-item-section"><slot /></div>',
          },
          "q-item-label": {
            template: '<span class="q-item-label"><slot /></span>',
          },
          "q-checkbox": {
            template:
              '<input type="checkbox" :checked="modelValue" @change="$emit(\'update:modelValue\', $event.target.checked)" />',
            props: ["modelValue"],
            emits: ["update:modelValue"],
          },
          "q-select": {
            template:
              '<select :data-test="$attrs[\'data-test\']"><slot /></select>',
            props: ["modelValue", "options"],
          },
          AddFolder: {
            template: '<div class="add-folder-mock"></div>',
            emits: ["update:modelValue"],
          },
        },
      },
    });
  };

  beforeEach(() => {
    vi.stubGlobal("fetch", mockFetch);
    vi.clearAllMocks();

    // Setup store state for githubDashboardGallery
    (store.state as any).githubDashboardGallery = {
      dashboards: [],
      lastFetched: null,
      cacheExpiry: 300000,
      dashboardJsonCache: {},
    };
    store.state.selectedOrganization = {
      identifier: "default",
      label: "default",
      id: 0,
      user_email: "",
      subscription_type: "",
    };

    // Default fetch mock - return empty folders
    mockFetch.mockResolvedValue(new Response("[]", { status: 200 }));

    vi.mocked(dashboardsService.list_Folders).mockResolvedValue(
      mockFolderList as any
    );
  });

  afterEach(() => {
    if (wrapper) {
      wrapper.unmount();
    }
    vi.unstubAllGlobals();
  });

  describe("Component Initialization", () => {
    it("should mount successfully", async () => {
      wrapper = createWrapper();
      await flushPromises();
      expect(wrapper.exists()).toBe(true);
    });

    it("should have correct component name", () => {
      wrapper = createWrapper({ modelValue: false });
      expect(wrapper.vm.$options.name).toBe("AddDashboardFromGitHub");
    });

    it("should initialize with empty dashboards list", async () => {
      wrapper = createWrapper({ modelValue: false });
      expect(wrapper.vm.dashboards).toEqual([]);
    });

    it("should initialize with empty selectedDashboards", async () => {
      wrapper = createWrapper({ modelValue: false });
      expect(wrapper.vm.selectedDashboards).toEqual([]);
    });

    it("should initialize with empty searchQuery", async () => {
      wrapper = createWrapper({ modelValue: false });
      expect(wrapper.vm.searchQuery).toBe("");
    });

    it("should initialize with loading as false", async () => {
      wrapper = createWrapper({ modelValue: false });
      expect(wrapper.vm.loading).toBe(false);
    });

    it("should initialize with error as empty string", async () => {
      wrapper = createWrapper({ modelValue: false });
      expect(wrapper.vm.error).toBe("");
    });

    it("should initialize with showFolderSelection as false", async () => {
      wrapper = createWrapper({ modelValue: false });
      expect(wrapper.vm.showFolderSelection).toBe(false);
    });
  });

  describe("show Computed Property", () => {
    it("should reflect modelValue prop as true", () => {
      wrapper = createWrapper({ modelValue: true });
      expect(wrapper.vm.show).toBe(true);
    });

    it("should reflect modelValue prop as false", () => {
      wrapper = createWrapper({ modelValue: false });
      expect(wrapper.vm.show).toBe(false);
    });

    it("should emit update:modelValue when show is set", () => {
      wrapper = createWrapper({ modelValue: true });
      wrapper.vm.show = false;
      expect(wrapper.emitted("update:modelValue")).toBeTruthy();
      expect(wrapper.emitted("update:modelValue")[0][0]).toBe(false);
    });
  });

  describe("filteredDashboards Computed", () => {
    beforeEach(() => {
      wrapper = createWrapper({ modelValue: false });
      wrapper.vm.dashboards = [
        { name: "aws_ec2", displayName: "AWS EC2", description: "EC2 monitoring", folderPath: "aws_ec2", jsonFiles: [] },
        { name: "nginx_web", displayName: "Nginx Web", description: "Nginx web server", folderPath: "nginx_web", jsonFiles: [] },
        { name: "kubernetes_cluster", displayName: "Kubernetes Cluster", folderPath: "kubernetes_cluster", jsonFiles: [] },
      ];
    });

    it("should return all dashboards when searchQuery is empty", () => {
      wrapper.vm.searchQuery = "";
      expect(wrapper.vm.filteredDashboards).toHaveLength(3);
    });

    it("should filter dashboards by displayName", () => {
      wrapper.vm.searchQuery = "aws";
      expect(wrapper.vm.filteredDashboards).toHaveLength(1);
      expect(wrapper.vm.filteredDashboards[0].name).toBe("aws_ec2");
    });

    it("should filter dashboards by description", () => {
      wrapper.vm.searchQuery = "web server";
      expect(wrapper.vm.filteredDashboards).toHaveLength(1);
      expect(wrapper.vm.filteredDashboards[0].name).toBe("nginx_web");
    });

    it("should be case insensitive", () => {
      wrapper.vm.searchQuery = "NGINX";
      expect(wrapper.vm.filteredDashboards).toHaveLength(1);
    });

    it("should return empty array when no match", () => {
      wrapper.vm.searchQuery = "nonexistent";
      expect(wrapper.vm.filteredDashboards).toHaveLength(0);
    });

    it("should filter dashboards without description", () => {
      wrapper.vm.searchQuery = "kubernetes";
      expect(wrapper.vm.filteredDashboards).toHaveLength(1);
      expect(wrapper.vm.filteredDashboards[0].name).toBe("kubernetes_cluster");
    });
  });

  describe("isSelected Function", () => {
    beforeEach(() => {
      wrapper = createWrapper({ modelValue: false });
    });

    it("should return false when dashboard is not selected", () => {
      const dashboard = { name: "aws_ec2", displayName: "AWS EC2", folderPath: "aws_ec2", jsonFiles: [] };
      expect(wrapper.vm.isSelected(dashboard)).toBe(false);
    });

    it("should return true when dashboard is selected", () => {
      const dashboard = { name: "aws_ec2", displayName: "AWS EC2", folderPath: "aws_ec2", jsonFiles: [] };
      wrapper.vm.selectedDashboards.push(dashboard);
      expect(wrapper.vm.isSelected(dashboard)).toBe(true);
    });
  });

  describe("toggleDashboard Function", () => {
    beforeEach(() => {
      wrapper = createWrapper({ modelValue: false });
    });

    it("should add dashboard to selectedDashboards when not selected", () => {
      const dashboard = { name: "aws_ec2", displayName: "AWS EC2", folderPath: "aws_ec2", jsonFiles: [] };
      wrapper.vm.toggleDashboard(dashboard);
      expect(wrapper.vm.selectedDashboards).toContainEqual(dashboard);
    });

    it("should remove dashboard from selectedDashboards when already selected", () => {
      const dashboard = { name: "aws_ec2", displayName: "AWS EC2", folderPath: "aws_ec2", jsonFiles: [] };
      wrapper.vm.selectedDashboards.push(dashboard);
      wrapper.vm.toggleDashboard(dashboard);
      expect(wrapper.vm.selectedDashboards).not.toContain(dashboard);
    });

    it("should toggle correctly on multiple calls", () => {
      const dashboard = { name: "aws_ec2", displayName: "AWS EC2", folderPath: "aws_ec2", jsonFiles: [] };
      wrapper.vm.toggleDashboard(dashboard);
      expect(wrapper.vm.selectedDashboards).toHaveLength(1);
      wrapper.vm.toggleDashboard(dashboard);
      expect(wrapper.vm.selectedDashboards).toHaveLength(0);
    });

    it("should handle multiple different dashboards", () => {
      const d1 = { name: "dash1", displayName: "Dash 1", folderPath: "d1", jsonFiles: [] };
      const d2 = { name: "dash2", displayName: "Dash 2", folderPath: "d2", jsonFiles: [] };
      wrapper.vm.toggleDashboard(d1);
      wrapper.vm.toggleDashboard(d2);
      expect(wrapper.vm.selectedDashboards).toHaveLength(2);
    });
  });

  describe("loadDashboards Function", () => {
    it("should set loading to true while fetching", async () => {
      mockFetch.mockImplementation(
        () =>
          new Promise((resolve) =>
            setTimeout(
              () =>
                resolve(new Response(s3FolderListXml([]), { status: 200 })),
              100
            )
          )
      );
      wrapper = createWrapper({ modelValue: false });
      const loadPromise = wrapper.vm.loadDashboards();
      expect(wrapper.vm.loading).toBe(true);
      await loadPromise;
    });

    it("should use cached data when cache is valid", async () => {
      const cachedDashboards = [
        { name: "cached", displayName: "Cached", folderPath: "cached", jsonFiles: [] },
      ];
      (store.state as any).githubDashboardGallery = {
        dashboards: cachedDashboards,
        lastFetched: Date.now(),
        cacheExpiry: 300000,
        dashboardJsonCache: {},
      };

      wrapper = createWrapper({ modelValue: false });
      await wrapper.vm.loadDashboards();

      expect(wrapper.vm.dashboards).toEqual(cachedDashboards);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("should fetch from S3 when cache is expired", async () => {
      (store.state as any).githubDashboardGallery = {
        dashboards: [],
        lastFetched: Date.now() - 400000, // expired
        cacheExpiry: 300000,
        dashboardJsonCache: {},
      };

      mockFetch.mockResolvedValue(
        new Response(s3FolderListXml(mockS3Folders), { status: 200 })
      );

      wrapper = createWrapper({ modelValue: false });
      await wrapper.vm.loadDashboards();
      await flushPromises();

      expect(mockFetch).toHaveBeenCalled();
    });

    it("should filter out dot-prefixed directories", async () => {
      mockFetch.mockResolvedValue(
        new Response(s3FolderListXml(mockS3Folders), { status: 200 })
      );

      wrapper = createWrapper({ modelValue: false });
      await wrapper.vm.loadDashboards();
      await flushPromises();

      const names = wrapper.vm.dashboards.map((d: any) => d.name);
      expect(names).not.toContain(".github");
      expect(names).toContain("aws");
      expect(names).toContain("nginx");
    });

    it("should only include folders from S3 CommonPrefixes response", async () => {
      // S3 ListObjectsV2 with delimiter=/ returns CommonPrefixes for folders
      // and Contents for files at the root level. parseS3Folders only reads CommonPrefixes.
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">
  <CommonPrefixes><Prefix>dashboards/aws/</Prefix></CommonPrefixes>
  <Contents><Key>dashboards/README.md</Key></Contents>
</ListBucketResult>`;
      mockFetch.mockResolvedValue(new Response(xml, { status: 200 }));

      wrapper = createWrapper({ modelValue: false });
      await wrapper.vm.loadDashboards();
      await flushPromises();

      const names = wrapper.vm.dashboards.map((d: any) => d.name);
      expect(names).toContain("aws");
      expect(names).not.toContain("README.md");
    });

    it("should set error when fetch fails", async () => {
      mockFetch.mockResolvedValue(new Response("{}", { status: 404 }));

      wrapper = createWrapper({ modelValue: false });
      await wrapper.vm.loadDashboards();
      await flushPromises();

      expect(wrapper.vm.error).toBe("Failed to fetch dashboards from gallery");
    });

    it("should set error on network error", async () => {
      mockFetch.mockRejectedValue(new Error("Network error"));

      wrapper = createWrapper({ modelValue: false });
      await wrapper.vm.loadDashboards();
      await flushPromises();

      expect(wrapper.vm.error).toBe("Network error");
    });

    it("should sort dashboards alphabetically", async () => {
      mockFetch.mockResolvedValue(
        new Response(s3FolderListXml(["z_last", "a_first", "m_middle"]), { status: 200 })
      );

      wrapper = createWrapper({ modelValue: false });
      await wrapper.vm.loadDashboards();
      await flushPromises();

      const names = wrapper.vm.dashboards.map((d: any) => d.displayName);
      expect(names[0]).toContain("a first");
    });

    it("should set loading to false after fetch completes", async () => {
      wrapper = createWrapper({ modelValue: false });
      await wrapper.vm.loadDashboards();
      await flushPromises();
      expect(wrapper.vm.loading).toBe(false);
    });
  });

  describe("handleNext Function", () => {
    it("should do nothing when no dashboards are selected", async () => {
      wrapper = createWrapper({ modelValue: false });
      wrapper.vm.selectedDashboards = [];
      await wrapper.vm.handleNext();
      expect(wrapper.vm.showFolderSelection).toBe(false);
    });

    it("should call loadFolders when dashboards are selected", async () => {
      vi.mocked(dashboardsService.list_Folders).mockResolvedValue(
        mockFolderList as any
      );
      mockFetch.mockResolvedValue(
        new Response(s3FileListXml("aws_ec2", ["dashboard.json"]), { status: 200 })
      );

      wrapper = createWrapper({ modelValue: false });
      wrapper.vm.selectedDashboards = [
        { name: "aws_ec2", displayName: "AWS EC2", folderPath: "aws_ec2", jsonFiles: [] },
      ];

      await wrapper.vm.handleNext();
      await flushPromises();

      expect(dashboardsService.list_Folders).toHaveBeenCalled();
    });

    it("should show folder selection dialog after successful next", async () => {
      vi.mocked(dashboardsService.list_Folders).mockResolvedValue(
        mockFolderList as any
      );
      mockFetch.mockResolvedValue(new Response("[]", { status: 200 }));

      wrapper = createWrapper({ modelValue: false });
      wrapper.vm.selectedDashboards = [
        { name: "aws_ec2", displayName: "AWS EC2", folderPath: "aws_ec2", jsonFiles: ["dash.json"] },
      ];

      await wrapper.vm.handleNext();
      await flushPromises();

      expect(wrapper.vm.showFolderSelection).toBe(true);
    });
  });

  describe("updateFolderList Function", () => {
    it("should hide add folder dialog", async () => {
      wrapper = createWrapper({ modelValue: false });
      wrapper.vm.showAddFolderDialog = true;
      await wrapper.vm.updateFolderList(null);
      expect(wrapper.vm.showAddFolderDialog).toBe(false);
    });

    it("should auto-select newly created folder", async () => {
      vi.mocked(dashboardsService.list_Folders).mockResolvedValue(
        mockFolderList as any
      );
      wrapper = createWrapper({ modelValue: false });

      await wrapper.vm.updateFolderList({
        data: { name: "New Folder", folderId: "new-folder-id" },
      });
      await flushPromises();

      expect(wrapper.vm.selectedFolderObj).toEqual({
        label: "New Folder",
        value: "new-folder-id",
      });
    });

    it("should not update selectedFolderObj when newFolder has no data", async () => {
      wrapper = createWrapper({ modelValue: false });
      wrapper.vm.selectedFolderObj = null;
      await wrapper.vm.updateFolderList(null);
      expect(wrapper.vm.selectedFolderObj).toBeNull();
    });
  });

  describe("Watch: show", () => {
    it("should call loadDashboards when dialog opens", async () => {
      mockFetch.mockResolvedValue(new Response("[]", { status: 200 }));
      wrapper = createWrapper({ modelValue: false });

      await wrapper.setProps({ modelValue: true });
      await flushPromises();

      expect(mockFetch).toHaveBeenCalled();
    });

    it("should reset selectedDashboards when dialog closes", async () => {
      wrapper = createWrapper({ modelValue: true });
      await flushPromises();

      wrapper.vm.selectedDashboards = [
        { name: "aws", displayName: "AWS", folderPath: "aws", jsonFiles: [] },
      ];

      await wrapper.setProps({ modelValue: false });
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.selectedDashboards).toEqual([]);
    });

    it("should reset searchQuery when dialog closes", async () => {
      wrapper = createWrapper({ modelValue: true });
      await flushPromises();

      wrapper.vm.searchQuery = "some search";

      await wrapper.setProps({ modelValue: false });
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.searchQuery).toBe("");
    });

    it("should reset showFolderSelection when dialog closes", async () => {
      wrapper = createWrapper({ modelValue: true });
      await flushPromises();

      wrapper.vm.showFolderSelection = true;

      await wrapper.setProps({ modelValue: false });
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.showFolderSelection).toBe(false);
    });
  });

  describe("loadFolders Function", () => {
    // loadFolders is triggered internally by handleNext(); pre-populate selectedDashboards
    // with jsonFiles so the fetch loop is skipped and loadFolders is called immediately.
    const preloadedDashboard = { name: "nginx", folderPath: "nginx", jsonFiles: ["nginx.json"] };

    it("should populate folderOptions from dashboards service", async () => {
      vi.mocked(dashboardsService.list_Folders).mockResolvedValue(
        mockFolderList as any
      );

      wrapper = createWrapper({ modelValue: false });
      wrapper.vm.selectedDashboards = [preloadedDashboard];
      await wrapper.vm.handleNext();
      await flushPromises();

      expect(wrapper.vm.folderOptions.length).toBeGreaterThan(0);
    });

    it("should ensure default folder is at top", async () => {
      vi.mocked(dashboardsService.list_Folders).mockResolvedValue({
        data: {
          list: [
            { folderId: "folder-1", name: "Folder 1" },
            { folderId: "default", name: "default" },
          ],
        },
      } as any);

      wrapper = createWrapper({ modelValue: false });
      wrapper.vm.selectedDashboards = [preloadedDashboard];
      await wrapper.vm.handleNext();
      await flushPromises();

      expect(wrapper.vm.folderOptions[0].value).toBe("default");
    });

    it("should set selectedFolderObj to null after loading", async () => {
      vi.mocked(dashboardsService.list_Folders).mockResolvedValue(
        mockFolderList as any
      );

      wrapper = createWrapper({ modelValue: false });
      wrapper.vm.selectedDashboards = [preloadedDashboard];
      wrapper.vm.selectedFolderObj = { label: "Old Folder", value: "old" };
      await wrapper.vm.handleNext();
      await flushPromises();

      expect(wrapper.vm.selectedFolderObj).toBeNull();
    });
  });

  describe("Template Rendering", () => {
    it("should render close button", async () => {
      wrapper = createWrapper({ modelValue: true });
      await flushPromises();
      expect(wrapper.find('[data-test="add-dashboard-github-close"]').exists()).toBe(true);
    });

    it("should render search input", async () => {
      wrapper = createWrapper({ modelValue: true });
      await flushPromises();
      expect(wrapper.find('[data-test="add-dashboard-github-search"]').exists()).toBe(true);
    });

    it("should render cancel button", async () => {
      wrapper = createWrapper({ modelValue: true });
      await flushPromises();
      expect(wrapper.find('[data-test="add-dashboard-github-cancel"]').exists()).toBe(true);
    });

    it("should render next button", async () => {
      wrapper = createWrapper({ modelValue: true });
      await flushPromises();
      expect(wrapper.find('[data-test="add-dashboard-github-next"]').exists()).toBe(true);
    });

    it("should disable next button when no dashboards selected", async () => {
      wrapper = createWrapper({ modelValue: true });
      await flushPromises();
      const nextBtn = wrapper.find('[data-test="add-dashboard-github-next"]');
      expect(nextBtn.element.disabled).toBe(true);
    });

    it("should show dashboard items when dashboards are loaded", async () => {
      wrapper = createWrapper({ modelValue: false });
      wrapper.vm.dashboards = [
        { name: "aws_ec2", displayName: "AWS EC2", folderPath: "aws_ec2", jsonFiles: [] },
      ];
      await wrapper.vm.$nextTick();
      expect(wrapper.find('[data-test="add-dashboard-github-item"]').exists()).toBe(true);
    });
  });
});
