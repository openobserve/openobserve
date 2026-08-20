// Copyright 2026 OpenObserve Inc.
//
// catalog.ts — the detection content that ships with the product.
//
// These rules are written in the Sigma format and carried in the bundle rather
// than fetched. Fetching the public corpus at runtime would put a network
// dependency between an analyst and their detections, which is wrong twice over:
// a SIEM is frequently the thing you reach for when the network is having a bad
// day, and a large share of the installs that need one most are air-gapped.
// Content that ships is content that works on day one, offline.
//
// Coverage is deliberately breadth-first. Every source type the classifier can
// recognise has rules that apply to it, so a stream that gets identified
// immediately has detections to run, rather than the pack being deep on Windows
// and empty everywhere else. The public SigmaHQ corpus is roughly a thousand
// Windows process-creation rules out of three thousand; importing that shape
// would leave a cloud-first install with nothing.
//
// Each rule is the plain, well-understood logic for its behaviour, tagged with
// the MITRE ATT&CK technique it covers. They are meant to be read, edited and
// argued with: a rule promoted to a detection carries this YAML with it, so what
// runs in production is the text an analyst can see.

import type { SigmaRule } from "./types";
import { matchesLogsource, parseSigmaRule } from "./parse";

const RULES: string[] = [
  // ── AWS CloudTrail ────────────────────────────────────────────────────────
  `title: AWS Root Account Activity
id: 2b1a2a3d-6b41-4e58-91f0-31b7e4b8b7a1
status: stable
description: >-
  The root account should be used only to set up an organisation and then locked
  away. Any activity on it after that is either an emergency or an incident.
references:
  - https://attack.mitre.org/techniques/T1078/004/
logsource:
  product: aws
  service: cloudtrail
detection:
  selection:
    userIdentity.type: Root
  filter_service_event:
    eventType: AwsServiceEvent
  condition: selection and not filter_service_event
falsepositives:
  - Deliberate break-glass access, which should still be reviewed
level: high
tags:
  - attack.privilege_escalation
  - attack.t1078.004`,

  `title: AWS CloudTrail Logging Disabled
id: 8f8b5a1e-2c37-4f2c-9c4d-7d0f3b1c9a22
status: stable
description: >-
  Stopping or deleting a trail is how an intruder stops the record of what they
  do next. It is rarely a routine administrative act.
references:
  - https://attack.mitre.org/techniques/T1562/008/
logsource:
  product: aws
  service: cloudtrail
detection:
  selection:
    eventSource: cloudtrail.amazonaws.com
    eventName:
      - StopLogging
      - DeleteTrail
      - UpdateTrail
      - PutEventSelectors
  condition: selection
falsepositives:
  - Trail reconfiguration during a planned logging migration
level: high
tags:
  - attack.defense_evasion
  - attack.t1562.008`,

  `title: AWS IAM Access Key Created
id: a7e2f5c0-9d81-4b6a-8f21-5a0c9e3b6f14
status: test
description: >-
  A long-lived access key is the most portable credential AWS issues, which makes
  creating one a common first step after an account takeover.
references:
  - https://attack.mitre.org/techniques/T1098/001/
logsource:
  product: aws
  service: cloudtrail
detection:
  selection:
    eventName: CreateAccessKey
  condition: selection
falsepositives:
  - Onboarding a new service account or rotating a key
level: medium
tags:
  - attack.persistence
  - attack.t1098.001`,

  `title: AWS Console Login Without MFA
id: c31f8b47-5a0d-4e19-9c88-2f4d6a1b7e05
status: stable
description: A successful console sign-in where no MFA factor was presented.
references:
  - https://attack.mitre.org/techniques/T1078/004/
logsource:
  product: aws
  service: cloudtrail
detection:
  selection:
    eventName: ConsoleLogin
    responseElements.ConsoleLogin: Success
  filter_mfa:
    additionalEventData.MFAUsed: 'Yes'
  filter_sso:
    additionalEventData.SamlProviderArn|exists: true
  condition: selection and not 1 of filter_*
falsepositives:
  - Federated sign-in where the identity provider enforced MFA upstream
level: medium
tags:
  - attack.initial_access
  - attack.t1078.004`,

  `title: AWS Security Group Opened To The Internet
id: 5d9c3e77-1b42-4a86-9f0e-8c2b5d47a913
status: test
description: >-
  An ingress rule sourced from 0.0.0.0/0 exposes whatever it protects to the
  entire internet, and is a routine precursor to opportunistic compromise.
references:
  - https://attack.mitre.org/techniques/T1562/007/
logsource:
  product: aws
  service: cloudtrail
detection:
  selection:
    eventName:
      - AuthorizeSecurityGroupIngress
      - ModifySecurityGroupRules
  world:
    requestParameters|contains:
      - '0.0.0.0/0'
      - '::/0'
  condition: selection and world
falsepositives:
  - Public load balancers and bastion hosts, which should be allow-listed
level: medium
tags:
  - attack.defense_evasion
  - attack.t1562.007`,

  `title: AWS GuardDuty Or Config Disabled
id: e0a4d3b9-77c5-4c21-b9a3-6e1f2d8c0475
status: test
description: Turning off the detection service before doing anything else.
references:
  - https://attack.mitre.org/techniques/T1562/001/
logsource:
  product: aws
  service: cloudtrail
detection:
  selection:
    eventName:
      - DeleteDetector
      - DisassociateFromMasterAccount
      - UpdateDetector
      - StopConfigurationRecorder
      - DeleteConfigurationRecorder
  condition: selection
level: high
tags:
  - attack.defense_evasion
  - attack.t1562.001`,

  `title: AWS Denied API Calls Burst
id: 4b7c1e08-3d95-4f60-8a12-9c6e0b5d3f28
status: experimental
description: >-
  Repeated authorisation failures from one principal are what enumeration looks
  like from the control plane's side.
references:
  - https://attack.mitre.org/techniques/T1580/
logsource:
  product: aws
  service: cloudtrail
detection:
  selection:
    errorCode:
      - AccessDenied
      - UnauthorizedOperation
      - Client.UnauthorizedOperation
  condition: selection
falsepositives:
  - A misconfigured application retrying a call it is not permitted to make
level: low
tags:
  - attack.discovery
  - attack.t1580`,

  // ── Okta ──────────────────────────────────────────────────────────────────
  `title: Okta MFA Factor Reset Or Deactivated
id: 6c1d9f24-8b53-4e07-a2f6-3d95c7e1b048
status: stable
description: >-
  Removing a second factor turns a stolen password back into a working
  credential, so a reset that no help desk ticket explains is a finding.
references:
  - https://attack.mitre.org/techniques/T1556/006/
logsource:
  product: okta
  service: okta
detection:
  selection:
    eventType:
      - user.mfa.factor.deactivate
      - user.mfa.factor.reset_all
      - user.mfa.attempt_bypass
  condition: selection
falsepositives:
  - A genuine help desk reset for a lost device
level: high
tags:
  - attack.persistence
  - attack.t1556.006`,

  `title: Okta Failed Authentication
id: b8e5a013-2f76-4c98-91d4-0a7b3e6c5f12
status: test
description: >-
  A single failure is noise; the value is in grouping these by actor and source
  address, which is what a detection built on this rule is for.
references:
  - https://attack.mitre.org/techniques/T1110/
logsource:
  product: okta
  service: okta
detection:
  selection:
    eventType:
      - user.session.start
      - user.authentication.auth_via_mfa
    outcome.result: FAILURE
  condition: selection
falsepositives:
  - Ordinary mistyped passwords
level: low
tags:
  - attack.credential_access
  - attack.t1110`,

  `title: Okta Administrator Role Granted
id: 9a2c4d68-7e15-4b03-8f6a-1c5d9e2b7043
status: stable
description: A privilege grant at the identity provider outranks any grant below it.
references:
  - https://attack.mitre.org/techniques/T1098/003/
logsource:
  product: okta
  service: okta
detection:
  selection:
    eventType:
      - user.account.privilege.grant
      - group.privilege.grant
  condition: selection
level: high
tags:
  - attack.privilege_escalation
  - attack.t1098.003`,

  `title: Okta API Token Created
id: 3f6b0d59-4a82-4e7c-b105-8d2f9c1e6a37
status: test
description: >-
  An API token survives a password reset and carries the creator's privileges,
  which makes it a durable foothold.
references:
  - https://attack.mitre.org/techniques/T1098/001/
logsource:
  product: okta
  service: okta
detection:
  selection:
    eventType: system.api_token.create
  condition: selection
falsepositives:
  - Provisioning a new integration
level: medium
tags:
  - attack.persistence
  - attack.t1098.001`,

  // ── Azure ─────────────────────────────────────────────────────────────────
  `title: Azure Sign-In Using Legacy Authentication
id: 7d3e8c14-6b09-4f25-a8d7-2e1c5b9f0463
status: stable
description: >-
  Legacy protocols cannot present a second factor, so they are the route of
  choice for password spraying against a tenant that otherwise enforces MFA.
references:
  - https://attack.mitre.org/techniques/T1110/003/
logsource:
  product: azure
  service: signinlogs
detection:
  selection:
    ClientAppUsed:
      - IMAP4
      - POP3
      - SMTP
      - MAPI
      - 'Exchange ActiveSync'
      - 'Other clients'
  condition: selection
falsepositives:
  - Legacy mail clients that have not been migrated
level: medium
tags:
  - attack.credential_access
  - attack.t1110.003`,

  `title: Azure Sign-In Blocked By Conditional Access
id: 1e9f4a72-0c68-4d31-95b7-3a6c2e8d5f19
status: test
description: >-
  A conditional access block is the control working, and a run of them from one
  principal is someone testing where the edges are.
references:
  - https://attack.mitre.org/techniques/T1078/004/
logsource:
  product: azure
  service: signinlogs
detection:
  selection:
    ResultType:
      - 53003
      - 53000
      - 53001
      - 50126
  condition: selection
level: low
tags:
  - attack.initial_access
  - attack.t1078.004`,

  `title: Azure Network Security Group Or Firewall Modified
id: 5b8d2f36-9e04-4a17-8c63-7f1e0d4b6923
status: test
description: A change to the boundary is a change to everything behind it.
references:
  - https://attack.mitre.org/techniques/T1562/007/
logsource:
  product: azure
  service: activitylogs
detection:
  selection:
    operationName|contains:
      - 'MICROSOFT.NETWORK/NETWORKSECURITYGROUPS/SECURITYRULES/WRITE'
      - 'MICROSOFT.NETWORK/NETWORKSECURITYGROUPS/SECURITYRULES/DELETE'
      - 'MICROSOFT.NETWORK/AZUREFIREWALLS/WRITE'
  condition: selection
falsepositives:
  - Infrastructure as code applying a reviewed change
level: medium
tags:
  - attack.defense_evasion
  - attack.t1562.007`,

  // ── GCP ───────────────────────────────────────────────────────────────────
  `title: GCP Service Account Key Created
id: 8c4a1b70-3d59-4e26-b0f8-6a2d9e7c1543
status: test
description: >-
  A downloadable service account key is a credential that leaves Google's
  control entirely, and it does not expire on its own.
references:
  - https://attack.mitre.org/techniques/T1098/001/
logsource:
  product: gcp
  service: gcp.audit
detection:
  selection:
    protoPayload.methodName|contains: 'serviceAccountKeys.create'
  condition: selection
falsepositives:
  - Legitimate provisioning, which should prefer workload identity federation
level: medium
tags:
  - attack.persistence
  - attack.t1098.001`,

  // ── Kubernetes audit ──────────────────────────────────────────────────────
  `title: Kubernetes Secrets Enumerated
id: 2a7e5c91-4f08-4b63-9d15-8c0b3e6a2f47
status: test
description: >-
  Listing secrets across a namespace is not something a workload does; it is what
  someone does once they have a token and want to know what it is worth.
references:
  - https://attack.mitre.org/techniques/T1552/007/
logsource:
  product: kubernetes
  service: audit
detection:
  selection:
    objectRef.resource: secrets
    verb:
      - list
      - watch
  filter_system:
    user.username|startswith: 'system:'
  condition: selection and not filter_system
falsepositives:
  - Controllers and operators that legitimately watch secrets
level: medium
tags:
  - attack.credential_access
  - attack.t1552.007`,

  `title: Kubernetes Exec Into Pod
id: 6f0d3a28-5b74-4c19-a2e6-9d5c1f8b4073
status: stable
description: >-
  An interactive shell in a running container bypasses the image, the pipeline
  and the review that produced them.
references:
  - https://attack.mitre.org/techniques/T1609/
logsource:
  product: kubernetes
  service: audit
detection:
  selection:
    objectRef.subresource:
      - exec
      - attach
    verb:
      - create
      - connect
  condition: selection
falsepositives:
  - Operators debugging a live incident
level: medium
tags:
  - attack.execution
  - attack.t1609`,

  `title: Kubernetes Cluster Admin Binding Created
id: 4d9b7e51-8a26-4f03-b7c4-1e6a0d3f5928
status: stable
description: Granting cluster-admin hands over the cluster.
references:
  - https://attack.mitre.org/techniques/T1078/
logsource:
  product: kubernetes
  service: audit
detection:
  selection:
    objectRef.resource:
      - clusterrolebindings
      - rolebindings
    verb:
      - create
      - update
      - patch
  admin:
    requestObject.roleRef.name:
      - cluster-admin
      - admin
  condition: selection and admin
level: high
tags:
  - attack.privilege_escalation
  - attack.t1078`,

  // ── GitHub ────────────────────────────────────────────────────────────────
  `title: GitHub Repository Visibility Or Protection Weakened
id: 9e1c6b40-2d87-4a35-8f09-5b3d7e2c1064
status: test
description: >-
  Making a repository public, or removing the branch protection that forces
  review, changes who can read the code and who can change it unobserved.
references:
  - https://attack.mitre.org/techniques/T1567/
logsource:
  product: github
  service: audit
detection:
  selection:
    action:
      - repo.access
      - protected_branch.destroy
      - protected_branch.policy_override
      - repo.remove_member
  condition: selection
falsepositives:
  - An intentional open-sourcing, which is still worth recording
level: medium
tags:
  - attack.exfiltration
  - attack.t1567`,

  // ── Windows process creation ──────────────────────────────────────────────
  `title: Encoded PowerShell Command
id: 3b6f9d17-4c25-4e80-a1d3-7f0b8e5c2946
status: stable
description: >-
  Base64-encoded command lines exist to keep the command out of the log. Almost
  nothing legitimate needs them, and almost every loader uses them.
references:
  - https://attack.mitre.org/techniques/T1059/001/
logsource:
  category: process_creation
  product: windows
detection:
  selection_img:
    Image|endswith:
      - '\\powershell.exe'
      - '\\pwsh.exe'
  selection_enc:
    CommandLine|windash|contains:
      - ' -enc '
      - ' -encodedcommand '
      - ' -ec '
  condition: all of selection_*
falsepositives:
  - Management tooling that wraps its own scripts
level: high
tags:
  - attack.execution
  - attack.t1059.001`,

  `title: Certutil Used To Download A File
id: 7a2e0c85-9b41-4d76-8e13-4c6f2b9d0357
status: stable
description: >-
  certutil is a certificate utility that happens to be able to fetch and decode
  arbitrary files, which is why it is a standard download cradle.
references:
  - https://attack.mitre.org/techniques/T1105/
logsource:
  category: process_creation
  product: windows
detection:
  selection:
    Image|endswith: '\\certutil.exe'
    CommandLine|windash|contains:
      - ' -urlcache '
      - ' -verifyctl '
      - ' -decode '
  condition: selection
level: high
tags:
  - attack.command_and_control
  - attack.t1105`,

  `title: Local System Reconnaissance Commands
id: 0d5b8a39-6e12-4f47-9c80-2a7d3e1b6f54
status: test
description: >-
  The first thing an operator does on a new host is find out where they landed.
  Individually these are ordinary; in sequence, from one process tree, they are not.
references:
  - https://attack.mitre.org/techniques/T1082/
logsource:
  category: process_creation
  product: windows
detection:
  selection:
    Image|endswith:
      - '\\whoami.exe'
      - '\\systeminfo.exe'
      - '\\nltest.exe'
      - '\\quser.exe'
  parent:
    ParentImage|endswith:
      - '\\cmd.exe'
      - '\\powershell.exe'
      - '\\wscript.exe'
      - '\\cscript.exe'
      - '\\winword.exe'
      - '\\excel.exe'
  condition: selection and parent
falsepositives:
  - Administrative scripts and inventory agents
level: medium
tags:
  - attack.discovery
  - attack.t1082`,

  `title: Shadow Copy Deletion
id: 8e3d1f60-7a94-4b28-9051-6c2b4d8e3a17
status: stable
description: >-
  Deleting volume shadow copies removes the only local means of recovery, which
  is why it is the step immediately before encryption.
references:
  - https://attack.mitre.org/techniques/T1490/
logsource:
  category: process_creation
  product: windows
detection:
  selection_vssadmin:
    Image|endswith: '\\vssadmin.exe'
    CommandLine|contains|all:
      - 'delete'
      - 'shadows'
  selection_wmic:
    Image|endswith: '\\wmic.exe'
    CommandLine|contains: 'shadowcopy delete'
  selection_bcdedit:
    Image|endswith: '\\bcdedit.exe'
    CommandLine|contains: 'recoveryenabled no'
  condition: 1 of selection_*
level: critical
tags:
  - attack.impact
  - attack.t1490`,

  `title: Run Key Persistence Via Reg.exe
id: 1c7a4e92-0b63-4d15-8f27-9e5c3a6b0d84
status: test
description: A registry Run key is the oldest and still the most common autostart.
references:
  - https://attack.mitre.org/techniques/T1547/001/
logsource:
  category: process_creation
  product: windows
detection:
  selection:
    Image|endswith: '\\reg.exe'
    CommandLine|contains|all:
      - 'add'
      - '\\CurrentVersion\\Run'
  condition: selection
falsepositives:
  - Installers registering a legitimate autostart
level: medium
tags:
  - attack.persistence
  - attack.t1547.001`,

  `title: Script Interpreter Spawned By An Office Application
id: 5f2b9c07-3e48-4a61-b9d5-0a7e6c1f4283
status: stable
description: >-
  A document should not start a shell. When one does, the document is the
  delivery mechanism.
references:
  - https://attack.mitre.org/techniques/T1566/001/
logsource:
  category: process_creation
  product: windows
detection:
  selection:
    ParentImage|endswith:
      - '\\winword.exe'
      - '\\excel.exe'
      - '\\powerpnt.exe'
      - '\\outlook.exe'
    Image|endswith:
      - '\\cmd.exe'
      - '\\powershell.exe'
      - '\\wscript.exe'
      - '\\cscript.exe'
      - '\\mshta.exe'
      - '\\rundll32.exe'
  condition: selection
level: critical
tags:
  - attack.initial_access
  - attack.t1566.001`,

  // ── Windows Security log ──────────────────────────────────────────────────
  `title: Windows Failed Logon
id: 2d8f5b13-4c76-4e09-a3b8-1f6d0c9e2745
status: stable
description: >-
  Event 4625 by itself is background noise; grouped by target account or source
  address over a window it is the clearest brute force signal Windows produces.
references:
  - https://attack.mitre.org/techniques/T1110/
logsource:
  product: windows
  service: security
detection:
  selection:
    EventID: 4625
  condition: selection
falsepositives:
  - Expired passwords and stale mapped drives
level: low
tags:
  - attack.credential_access
  - attack.t1110`,

  `title: Windows Security Log Cleared
id: 6b0e3d47-8f25-4a91-b7c0-3d5a2e8f1690
status: stable
description: >-
  The audit log is cleared for exactly one reason. Event 1102 is the record the
  system writes about its own erasure.
references:
  - https://attack.mitre.org/techniques/T1070/001/
logsource:
  product: windows
  service: security
detection:
  selection:
    EventID:
      - 1102
      - 104
  condition: selection
level: high
tags:
  - attack.defense_evasion
  - attack.t1070.001`,

  `title: User Added To A Privileged Windows Group
id: 9c5d0a86-1b39-4f72-8e04-7a3c6b2d5f81
status: stable
description: Membership of Administrators or Domain Admins is the crown jewel.
references:
  - https://attack.mitre.org/techniques/T1098/
logsource:
  product: windows
  service: security
detection:
  selection:
    EventID:
      - 4728
      - 4732
      - 4756
  privileged:
    TargetUserName|contains:
      - 'Admins'
      - 'Administrators'
      - 'Remote Desktop Users'
  condition: selection and privileged
falsepositives:
  - Reviewed administrative onboarding
level: high
tags:
  - attack.persistence
  - attack.t1098`,

  `title: Windows Service Installed
id: 4e7c2b95-0d68-4a13-9f56-8b1e3d0c7a24
status: test
description: >-
  Installing a service is how a foothold survives a reboot, and how remote
  execution tooling lands on a host.
references:
  - https://attack.mitre.org/techniques/T1543/003/
logsource:
  product: windows
  service: security
detection:
  selection:
    EventID: 4697
  condition: selection
falsepositives:
  - Software installation and patching
level: medium
tags:
  - attack.persistence
  - attack.t1543.003`,

  // ── Linux ─────────────────────────────────────────────────────────────────
  `title: SSH Authentication Failure
id: 7f1a6c30-2e85-4b47-90d3-5c8f2a1e6b09
status: stable
description: >-
  Failed password and invalid user lines from sshd are the raw material for
  brute force detection on anything with a public address.
references:
  - https://attack.mitre.org/techniques/T1110/
logsource:
  product: linux
  service: auth
detection:
  keywords:
    - 'Failed password for'
    - 'Invalid user'
    - 'authentication failure'
  condition: keywords
falsepositives:
  - Users with an expired key
level: low
tags:
  - attack.credential_access
  - attack.t1110`,

  `title: SSH Accepted Login For Root
id: 0a4e8b72-6d15-4c39-b208-7f3a9e5c1d46
status: test
description: >-
  Direct root login over SSH removes the accountability that sudo provides, and
  most hardened builds disable it entirely.
references:
  - https://attack.mitre.org/techniques/T1078/003/
logsource:
  product: linux
  service: auth
detection:
  keywords:
    - 'Accepted password for root'
    - 'Accepted publickey for root'
  condition: keywords
falsepositives:
  - Automation that has not yet moved to a named account
level: medium
tags:
  - attack.persistence
  - attack.t1078.003`,

  `title: Sudo Authentication Failure
id: 3c9f5d18-7b40-4e26-a1f7-6d2b8c0e4935
status: test
description: A user probing for privileges they do not have.
references:
  - https://attack.mitre.org/techniques/T1548/003/
logsource:
  product: linux
  service: auth
detection:
  keywords:
    - 'user NOT in sudoers'
    - 'incorrect password attempts'
    - '3 incorrect password attempts'
  condition: keywords
level: medium
tags:
  - attack.privilege_escalation
  - attack.t1548.003`,

  `title: Sudoers Configuration Modified
id: 8d2c7a04-5e91-4b68-9037-1a6f4e2d8c53
status: test
description: >-
  Editing sudoers grants privileges that persist, silently, until someone reads
  the file again.
references:
  - https://attack.mitre.org/techniques/T1548/003/
logsource:
  product: linux
  service: auditd
detection:
  selection:
    type: PATH
    name|startswith:
      - '/etc/sudoers'
      - '/etc/sudoers.d/'
  condition: selection
falsepositives:
  - Configuration management applying a reviewed change
level: high
tags:
  - attack.privilege_escalation
  - attack.t1548.003`,

  // ── Web ───────────────────────────────────────────────────────────────────
  `title: SQL Injection Attempt In Request Path
id: 1b8e4f63-9c07-4d52-8a16-3e7d5b0c2f94
status: test
description: >-
  The classic tautologies and stacked statements, seen in the URI. Volume here
  is mostly untargeted scanning, but a success buried in it is not.
references:
  - https://attack.mitre.org/techniques/T1190/
logsource:
  category: webserver
detection:
  selection:
    c-uri|contains:
      - 'union select'
      - 'union+select'
      - "' or '1'='1"
      - '1=1--'
      - 'information_schema'
      - 'sleep('
      - 'benchmark('
  condition: selection
falsepositives:
  - Security scanners and documentation pages about SQL
level: high
tags:
  - attack.initial_access
  - attack.t1190`,

  `title: Path Traversal Attempt
id: 5a0d9c27-4b68-4f31-b95e-8c2a7d1e6034
status: test
description: An attempt to escape the document root and read arbitrary files.
references:
  - https://attack.mitre.org/techniques/T1083/
logsource:
  category: webserver
detection:
  selection:
    c-uri|contains:
      - '../../'
      - '..%2f'
      - '%2e%2e%2f'
      - '/etc/passwd'
      - 'c:\\windows\\win.ini'
  condition: selection
level: high
tags:
  - attack.discovery
  - attack.t1083`,

  `title: Web Shell Or Admin Console Probing
id: 9f3b6e50-8d24-4a07-91c6-5b0e2f7a3d18
status: test
description: >-
  Requests for the file names web shells are usually dropped under, and for the
  administrative endpoints that get scanned within minutes of going public.
references:
  - https://attack.mitre.org/techniques/T1505/003/
logsource:
  category: webserver
detection:
  selection:
    c-uri|contains:
      - '/shell.php'
      - '/cmd.jsp'
      - '/wso.php'
      - '/.env'
      - '/wp-admin/admin-ajax.php'
      - '/phpmyadmin'
      - '/.git/config'
  condition: selection
falsepositives:
  - Internet background noise, which is constant and worth baselining
level: medium
tags:
  - attack.persistence
  - attack.t1505.003`,

  `title: Executable Downloaded Through The Proxy
id: 6e5c1a94-3f70-4b82-a0d9-7c4b8e2f5301
status: test
description: An executable arriving over the web, from a host nobody has vetted.
references:
  - https://attack.mitre.org/techniques/T1105/
logsource:
  category: proxy
detection:
  selection:
    c-uri|endswith:
      - '.exe'
      - '.dll'
      - '.scr'
      - '.hta'
      - '.ps1'
      - '.bat'
  condition: selection
falsepositives:
  - Software distribution from vendors, which should be allow-listed
level: medium
tags:
  - attack.command_and_control
  - attack.t1105`,

  // ── DNS ───────────────────────────────────────────────────────────────────
  `title: DNS Query To A Dynamic DNS Or Tunnelling Provider
id: 2f7d0b46-5a83-4c19-9e05-1d6c3b8a4e72
status: test
description: >-
  Free subdomains are where inexpensive infrastructure lives. Legitimate use
  exists, which is why this is a lead rather than a verdict.
references:
  - https://attack.mitre.org/techniques/T1071/004/
logsource:
  category: dns_query
detection:
  selection:
    query|endswith:
      - '.duckdns.org'
      - '.no-ip.org'
      - '.ddns.net'
      - '.ngrok.io'
      - '.trycloudflare.com'
      - '.serveo.net'
  condition: selection
falsepositives:
  - Developers using a tunnel to expose a local service
level: medium
tags:
  - attack.command_and_control
  - attack.t1071.004`,

  `title: Suspiciously Long DNS Query
id: 7c4a2e81-0b59-4d36-8f17-9a5d6c3b0e42
status: experimental
description: >-
  Data leaving over DNS has to be encoded into the name, which makes the name
  long. The threshold is a heuristic and will need tuning per environment.
references:
  - https://attack.mitre.org/techniques/T1048/003/
logsource:
  category: dns_query
detection:
  selection:
    query|re: '^[A-Za-z0-9+/=_-]{60,}\\.'
  condition: selection
falsepositives:
  - Content delivery and anti-spam services that encode into hostnames
level: medium
tags:
  - attack.exfiltration
  - attack.t1048.003`,

  // ── Flow and network telemetry ────────────────────────────────────────────
  `title: VPC Flow Rejected To A Remote Administration Port
id: 3e8a5d29-7c14-4b60-95f2-0d4c6b1a8e37
status: test
description: >-
  Rejected flows toward SSH, RDP or WinRM are the shape of someone walking the
  address range looking for a way in.
references:
  - https://attack.mitre.org/techniques/T1046/
logsource:
  product: aws
  service: vpcflow
detection:
  selection:
    action: REJECT
    dstport:
      - 22
      - 3389
      - 5985
      - 5986
  condition: selection
falsepositives:
  - Health checks against a port that is deliberately closed
level: medium
tags:
  - attack.discovery
  - attack.t1046`,

  `title: Zeek Connection With No Response
id: 7b1f4c60-2a95-4d38-8e07-6c3b9a5d2f81
status: experimental
description: >-
  A run of connection attempts that never complete a handshake, from one source,
  is a port scan. Zeek's conn_state records exactly that.
references:
  - https://attack.mitre.org/techniques/T1046/
logsource:
  product: zeek
  service: conn
detection:
  selection:
    conn_state:
      - S0
      - REJ
      - RSTOS0
  condition: selection
falsepositives:
  - Monitoring probes and hosts that have been decommissioned
level: low
tags:
  - attack.discovery
  - attack.t1046`,

  `title: IDS Alert Of High Severity
id: 0c6d2b83-4e57-4a19-b6f0-9d1a7e3c5824
status: stable
description: >-
  The sensor has already made a judgement. This surfaces the top of its scale so
  it lands in the same triage queue as everything else rather than a separate one.
references:
  - https://attack.mitre.org/techniques/T1071/
logsource:
  product: suricata
detection:
  selection:
    alert.severity|lte: 2
  condition: selection
falsepositives:
  - Whatever the signature set is noisy about, which is environment specific
level: high
tags:
  - attack.command_and_control
  - attack.t1071`,

  // ── Already-normalised OCSF ───────────────────────────────────────────────
  `title: OCSF Failed Authentication
id: 5d0b7e14-8c36-4f92-a715-2b6e4d9c0f38
status: stable
description: >-
  A stream already in OCSF needs no field mapping, so the rule is written
  directly against the schema: a failed event in the Authentication class.
references:
  - https://attack.mitre.org/techniques/T1110/
logsource:
  category: application
detection:
  selection:
    class_uid: 3002
    status_id: 2
  condition: selection
falsepositives:
  - Ordinary mistyped passwords
level: low
tags:
  - attack.credential_access
  - attack.t1110`,

  `title: OCSF High Severity Finding
id: 2a9c6f05-3b81-4e47-9d20-7f5a1c8b3e69
status: stable
description: Anything the producer itself rated high or above.
references:
  - https://attack.mitre.org/techniques/T1204/
logsource:
  category: application
detection:
  selection:
    severity_id|gte: 4
  filter_unknown:
    severity_id: 99
  condition: selection and not filter_unknown
level: high
tags:
  - attack.execution
  - attack.t1204`,

  // ── Firewall ──────────────────────────────────────────────────────────────
  `title: Inbound Connection To A File Sharing Or Database Port
id: 4a9e7b25-1c60-4f38-b842-0e7d5a3c9f16
status: test
description: >-
  SMB, RDP and database ports reachable from outside the network are how a
  perimeter mistake becomes an incident.
references:
  - https://attack.mitre.org/techniques/T1021/
logsource:
  category: firewall
detection:
  selection:
    dst_port:
      - 445
      - 3389
      - 3306
      - 5432
      - 27017
      - 6379
  internal:
    src_ip|cidr:
      - '10.0.0.0/8'
      - '192.168.0.0/16'
  condition: selection and not internal
falsepositives:
  - Deliberately published services, which should be documented
level: high
tags:
  - attack.lateral_movement
  - attack.t1021`,
];

/**
 * Sigma field names onto stream columns, per source type.
 *
 * Rules are written against Sigma's taxonomy, which is the vendor's own naming
 * for products (CloudTrail's `eventName`) but a normalised one for categories
 * (`c-uri` for any web server). Streams follow neither reliably, so the gap is
 * bridged here rather than by rewriting rules per customer. Only genuine
 * differences are listed; a field the stream already spells the Sigma way needs
 * no entry, and the compiler falls back to a case-insensitive column match.
 */
export const SIGMA_FIELD_MAPS: Record<string, Record<string, string>> = {
  webserver_access: {
    "c-uri": "path",
    "cs-uri": "path",
    "cs-uri-stem": "path",
    "cs-method": "method",
    "sc-status": "status",
    "c-ip": "remote_addr",
    "cs-host": "host",
    "cs-user-agent": "user_agent",
  },
  dns_query: {
    query: "query",
    answer: "answers",
    record_type: "query_type",
  },
  linux_auditd: {
    type: "type",
    name: "name",
  },
};

/** The columns a bare-string search looks in, per source type. */
export const KEYWORD_FIELDS: Record<string, string[]> = {
  linux_auth: ["message"],
  syslog_generic: ["message"],
  application_log: ["message"],
  kubernetes_container: ["log", "message"],
};

let parsed: SigmaRule[] | null = null;
let failures: { message: string; yaml: string }[] = [];

/**
 * The pack, parsed once.
 *
 * A rule that fails to parse is kept in `catalogErrors` rather than dropped, so
 * a mistake in shipped content shows up as a visible problem instead of a rule
 * that quietly never fires.
 */
export function sigmaCatalog(): SigmaRule[] {
  if (parsed) return parsed;
  const rules: SigmaRule[] = [];
  const errors: typeof failures = [];
  for (const text of RULES) {
    const result = parseSigmaRule(text);
    if (result.ok) rules.push(result.rule);
    else errors.push(result.error);
  }
  parsed = rules;
  failures = errors;
  return parsed;
}

export function catalogErrors() {
  sigmaCatalog();
  return failures;
}

/** Rules written for a stream's logsource triple. */
export function rulesForLogsource(stream: {
  category?: string;
  product?: string;
  service?: string;
}): SigmaRule[] {
  return sigmaCatalog().filter((rule) => matchesLogsource(rule, stream));
}

/** Every ATT&CK technique the pack covers, for the coverage view. */
export function catalogTechniques(): string[] {
  const techniques = new Set<string>();
  for (const rule of sigmaCatalog()) rule.techniques.forEach((id) => techniques.add(id));
  return [...techniques].sort();
}
