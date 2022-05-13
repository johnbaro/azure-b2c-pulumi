import * as pulumi from "@pulumi/pulumi";
import * as resources from "@pulumi/azure-native/resources";
import * as azureactivedirectory from "@pulumi/azure-native/azureactivedirectory";
import * as azProvider from "@pulumi/azure-native/provider";
import * as azuread from "@pulumi/azuread";
import { Output } from '@pulumi/pulumi';
import * as random from '@pulumi/random';

export = async () => {
    const config = new pulumi.Config();

    const out: Partial<Output<{
        tenantId?: string;
        clientId: string;
        powershellClientAppSecret: any;
        identityExperienceFrameworkAppId: string;
        proxyIdentityExperienceFrameworkAppId: string;
        tenantName: string;
    }>> = {};

    const tenantName = 'b2ctestpulumi';
    out.tenantName = pulumi.output(tenantName);

    const b2cRg = new resources.ResourceGroup("b2cRg");

    const b2cTenant = new azureactivedirectory.B2CTenant("b2cTenant", {
        location: "Australia",
        properties: {
            countryCode: "AU",
            displayName: "PulumiB2c",
        },
        resourceGroupName: b2cRg.name,
        resourceName: `${tenantName}.onmicrosoft.com`,
        sku: {
            name: azureactivedirectory.B2CResourceSKUName.Standard,
            tier: azureactivedirectory.B2CResourceSKUTier.A0,
        },
    });

    out.tenantId = b2cTenant.tenantId!;

    const b2cProvider = new azuread.Provider('b2cProvider', { tenantId: b2cTenant.tenantId.apply(v => v!) });

    const publishedAppIdData = (await azuread.getApplicationPublishedAppIds()).result;
    const msGraphAppId = publishedAppIdData["MicrosoftGraph"];


    const graphSp = new azuread.ServicePrincipal('graphSp', {
        applicationId: msGraphAppId,
        useExisting: true,
    }, { provider: b2cProvider });

    const graphSpRoleId = graphSp.appRoleIds["Application.ReadWrite.All"];



    ///////////////////////////////////////////////////////////////////////////
    // Test graph worker app 
    //obsolete
    ///////////////////////////////////////////////////////////////////////////
    const graphWorkerApp = new azuread.Application('graphWorkerApp', {
        displayName: "graphWorkerApp",
        signInAudience: "AzureADMyOrg",
        web: {
            redirectUris: ["http://localhost/"]
        },
        requiredResourceAccesses: [
            {
                resourceAppId: msGraphAppId,
                resourceAccesses: [
                    {
                        id: graphSpRoleId,
                        type: "Role"
                    }
                ]
            }
        ]
    }, { provider: b2cProvider });

    const graphWorkerSp = new azuread.ServicePrincipal('graphWorkerSp', {
        applicationId: graphWorkerApp.applicationId
    }, { provider: b2cProvider });

    const graphWorkerAppRoleAssignment = new azuread.AppRoleAssignment('graphWorkerAppRoleAssignment', {
        appRoleId: graphSpRoleId,
        principalObjectId: graphWorkerSp.objectId,
        resourceObjectId: graphSp.objectId,
    }, { provider: b2cProvider });

    ///////////////////////////////////////////////////////////////////////////
    // END - Test graph worker app 
    ///////////////////////////////////////////////////////////////////////////

    const trustFrameworkRoleId = graphSp.appRoleIds["Policy.ReadWrite.TrustFramework"];
    const trustFrameworkKeySetRoleId = graphSp.appRoleIds["TrustFrameworkKeySet.ReadWrite.All"];

    ///////////////////////////////////////////////////////////////////////////
    // Powershell client app
    ///////////////////////////////////////////////////////////////////////////

    const powershellClientApp = new azuread.Application('powershellClientApp', {
        displayName: "PowershellClient",
        signInAudience: "AzureADMyOrg",
        web: {
            redirectUris: ["http://localhost/"]
        },
        requiredResourceAccesses: [
            {
                resourceAppId: msGraphAppId,
                resourceAccesses: [
                    {
                        id: trustFrameworkRoleId,
                        type: "Role"
                    },
                    {
                        id: trustFrameworkKeySetRoleId,
                        type: "Role"
                    }
                ]
            }
        ]
    }, { provider: b2cProvider });
    out.clientId = powershellClientApp.applicationId;

    const powershellClientSp = new azuread.ServicePrincipal('powershellClientSp', {
        applicationId: powershellClientApp.applicationId
    }, { provider: b2cProvider });

    const powershellClientAppRoleAssignment01 = new azuread.AppRoleAssignment('powershellClientAppRoleAssignment01', {
        appRoleId: trustFrameworkRoleId,
        principalObjectId: powershellClientSp.objectId,
        resourceObjectId: graphSp.objectId,
    }, { provider: b2cProvider });

    const powershellClientAppRoleAssignment02 = new azuread.AppRoleAssignment('powershellClientAppRoleAssignment02', {
        appRoleId: trustFrameworkKeySetRoleId,
        principalObjectId: powershellClientSp.objectId,
        resourceObjectId: graphSp.objectId,
    }, { provider: b2cProvider });

    const powershellClientAppSecret = new azuread.ApplicationPassword('powershellClientAppSecret', {
        displayName: 'CLI Secret',
        applicationObjectId: powershellClientApp.objectId,

    }, { provider: b2cProvider });
    out.powershellClientAppSecret = powershellClientAppSecret.value;

    ///////////////////////////////////////////////////////////////////////////
    // END - Powershell client app
    ///////////////////////////////////////////////////////////////////////////

    ///////////////////////////////////////////////////////////////////////////
    // IdentityExperienceFramework app
    ///////////////////////////////////////////////////////////////////////////

    const offlineAccessScopeId = graphSp.oauth2PermissionScopeIds["offline_access"];
    const openIdScopeId = graphSp.oauth2PermissionScopeIds["openid"];

    const iefAppPermissionScopeId = new random.RandomUuid('apiId').result;
    const iefAppPermissionScopeName = 'user_impersonation';
    const iefAppIdentifierUriId = new random.RandomUuid('iefAppIdentifierUriId').result;

    const iefApp = new azuread.Application('iefApp', {
        displayName: "IdentityExperienceFramework",
        signInAudience: "AzureADMyOrg",
        web: {
            redirectUris: [`https://${tenantName}.b2clogin.com/your-tenant-name.onmicrosoft.com`]
        },
        requiredResourceAccesses: [
            {
                resourceAppId: msGraphAppId,
                resourceAccesses: [
                    {
                        id: offlineAccessScopeId,
                        type: "Scope"
                    },
                    {
                        id: openIdScopeId,
                        type: "Scope"
                    }
                ]
            }
        ],
        identifierUris: [pulumi.interpolate`https://${tenantName}.onmicrosoft.com/${iefAppIdentifierUriId}`],
        api: {
            oauth2PermissionScopes: [{
                id: iefAppPermissionScopeId,
                adminConsentDisplayName: "Access IdentityExperienceFramework",
                adminConsentDescription: "Allow the application to access IdentityExperienceFramework on behalf of the signed-in user",
                value: iefAppPermissionScopeName,
                type: "Admin",
            }],
        }
    }, { provider: b2cProvider, deleteBeforeReplace: true });
    out.identityExperienceFrameworkAppId = iefApp.applicationId;

    const iefSp = new azuread.ServicePrincipal('iefSp', {
        applicationId: iefApp.applicationId
    }, { provider: b2cProvider });

    ///////////////////////////////////////////////////////////////////////////
    // END - IdentityExperienceFramework app
    ///////////////////////////////////////////////////////////////////////////

    ///////////////////////////////////////////////////////////////////////////
    // ProxyIdentityExperienceFramework app
    ///////////////////////////////////////////////////////////////////////////

    const proxyIefAppRedirectUri = 'ms-appx-web://auth/';

    const proxyIefApp = new azuread.Application('proxyIefApp', {
        displayName: "ProxyIdentityExperienceFramework",
        signInAudience: "AzureADMyOrg",
        web: {
            redirectUris: [proxyIefAppRedirectUri]
        },
        requiredResourceAccesses: [
            {
                resourceAppId: msGraphAppId,
                resourceAccesses: [
                    {
                        id: offlineAccessScopeId,
                        type: "Scope"
                    },
                    {
                        id: openIdScopeId,
                        type: "Scope"
                    }
                ]
            },
            {
                resourceAppId: iefApp.applicationId,
                resourceAccesses: [
                    {
                        id: iefAppPermissionScopeId,
                        type: "Scope",
                    }
                ]
            }
        ],
        fallbackPublicClientEnabled: true,
    }, { provider: b2cProvider, deleteBeforeReplace: true });
    out.proxyIdentityExperienceFrameworkAppId = proxyIefApp.applicationId;

    const proxyIefSp = new azuread.ServicePrincipal('proxyIefSp', {
        applicationId: proxyIefApp.applicationId
    }, { provider: b2cProvider });

    const proxyIefToIefAppPermissionsAuth01 = new azuread.ServicePrincipalDelegatedPermissionGrant('proxyIefToIefAppPermissionsAuth01', {
        servicePrincipalObjectId: proxyIefSp.objectId,
        resourceServicePrincipalObjectId: iefSp.objectId,
        claimValues: [iefAppPermissionScopeName]
    }, { provider: b2cProvider });

    ///////////////////////////////////////////////////////////////////////////
    // END - ProxyIdentityExperienceFramework app
    ///////////////////////////////////////////////////////////////////////////

    return out;
}