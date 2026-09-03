export interface PermissionStatus {
  hasAllRequired: boolean;
  missingPermissions: string[];
  missingOrigins: string[];
}

export async function checkExtensionPermissions(): Promise<PermissionStatus> {
  const requiredPermissions = ['storage', 'tabs', 'activeTab'];
  const missingPermissions: string[] = [];

  for (const perm of requiredPermissions) {
    try {
      const has = await chrome.permissions.contains({ permissions: [perm as any] });
      if (!has) {
        missingPermissions.push(perm);
      }
    } catch {
      // Permission API not supported or restricted
    }
  }

  return {
    hasAllRequired: missingPermissions.length === 0,
    missingPermissions,
    missingOrigins: [],
  };
}

export async function requestMissingPermissions(permissions: string[]): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    try {
      chrome.permissions.request({ permissions: permissions as any }, (granted) => {
        resolve(!!granted);
      });
    } catch (err) {
      console.warn('[Chetty] Permission request rejected or failed:', err);
      resolve(false);
    }
  });
}
