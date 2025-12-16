- variables will now exists at 3 levels. gloabl, tabs and panel. the current implementaion is like all the variables are global
- when the vairables is added it should be assigned scope "global", "tab" or "panel". all the previous dashboard, we can consider it a global scope if not explicitly specified. 
- Each vairable can be assigned to 1 or more tabs or panel depending on the scope defined.
- if a variable "a" is assinged to 2 tabs - t1 and t2, both will hold different values and user can update them indipendnly. same for panels as well
- it should build a variable deps tree and load from the top to bottom
- all the independent variables should start loading as the dashboard loads, and should trigger their dependent variables once they have got the value.
- now here important point is the variables loading is done with streaming as per the current implementaion and that should work the same way. as soon as we receive the partial data and we have some value it continues to load further but as we have got the initial value it can trigger the depended vairables.
- here are some examples of the allowed loading hierarchy:

global -> global (allowed)
global -> tab (allowed)
global -> panel (allowed)
global -> tab -> panel (allowed)
tab -> same tab (allowed)
tab -> panel (allowed)
panel -> panel (allowed)

❌ NOT ALLOWED:
tab -> global : a global variables can not depend on the tab level variable
panel -> global: a global variables can not depend on the panel level variable
panel -> tab: a tab variables can not depend on the panel level variable

- there are 2 properties we use to indicate the loading status:
1. isLoading - api is currently fired and waiting for it to complete the response
2. isVariableLoadingPending - this variable needs to be loaded, but waiting for the parents to complete loading and trigger him to initiate the loading
3. isVariablePartialLoaded - the api is fired and we have received the partial/first response to determine the value of it and this can continue to load, but as this has received the value it can trigger the child variables to load, to speed up the loading of hierachy so that the panels can untiltly start the loading if all the deps are loaded

- lazy loading of variables: previously there was no lazy loading, but now we will have a lazy loading of vairables similar to panels. until the panel becomes visible we should not load the vairable as well. so deps should be followed and triggered only when the panel becomes visible. global can be triggred initially. tab level variable should be triggered when it becomes active, and panel level should be triggered when it is visble. we can use the "isVariableLoadingPending" to trigger the loading of the vairables. when the variable becomes visible we should trigger the loading.

- previosuly only a single component was managing the loading (VariablesValueSelector). now the same compoinetn will be displayed at multiple places, so it can not control the full loading of the vairables. We need a new composable to manage the loading of the vairables. the compoentn rendered at gloabl, tab and panel should use this composable to manage the loading of the vairables. the composable should be responsible of managing the loading of the vairables collecting requests of the variables loading and maintaining the gloabl state of all the variables which can be consumed by panels for determining if the panels can be loaded

- we need to create some methods to identify that the current compoentn will handle the loading of how many variables depending on where it is rendered (eg. tab1, tab2, panle1, panel2 etc)

- in the view panel popup and add panel popup, the panel is shown independent without tabs and global vars, show there, we shoud pass all the applicable variables for that panel and the component can manage the loading of all the variables.

- to maintain the proper state for each variable in different tabs or panels, we can split and create multiple entries in the variables list so that each can have its different value and loading state.

like if a variable "a" is assinged to tab1 and tab2, it will add 2 variables in the list for internal state

e.g: 
[
    {
        name: "a",
        scope: "tab1",
        value: null,
        isLoading: false,
        isVariableLoadingPending: false,
        isVariablePartialLoaded: false
    },
    {
        name: "a",
        scope: "tab2",
        value: null,
        isLoading: false,
        isVariableLoadingPending: false,
        isVariablePartialLoaded: false
    }
]

- there is one scenario that if the varaible is loaded and we could not get any value for it (like api doesn't return anything) then we have to set the value to null and if the variable is loaded and the value is null, then while replacing the values, we are passing _o2_all_ in teh panel query so that backend can drop the filter and can load all the data. 

so in the variables loading, one variable is loaded and the value is null as we have not got any values, it should fire child loading and it can also set the value to null and trigger their child to continue till the end and say loaded with null values. so panel replacement will manage the loading with _o2_all_. 

- so as we have got the same name variables with multiple tabs and for panels as well, syncing those values to URL and getting initial values from it requires some modification as well. 

current vairable implementation:
- var-{name}={value}

e.g.
- var-a=1

so we can adopt to this:

1. no change for global variables

2. for tab lavel variable:
-var-{name}.t.{tabId}={value}

e.g.
-var-a.t.id123=1
-var-a.t.id456=2

3. for panel level variable:
-var-{name}.p.{panelId}={value}

e.g.
-var-a.p.id123=1
-var-a.p.id456=2

so based on this, you should pick up the correct value for different tabs or panels


in the case where in the URL, when we find the variable, of a tab level without the indicators, we should apply that value to all the tabs that is applicable.

for an exmaple, for a variable "a" that is assigned to tab1 and tab2, if we have var-a=1 in the URL, we should apply that value to both tabs. this can happen when user is passing values from the drilldown option, as they can not select the tab and panel while constructing the url from the options

- so whenever we are applying filters in add panel, it should only be able to select from the variables that panel can see (based on the scope: all global, tab's panel, and that panel level variables)

- in the drilldown, all the vairables should be avaialble

- in the add panel page, we have to add a temp suport for creating variables and that is only saved to dashboard, if user saves the panel.