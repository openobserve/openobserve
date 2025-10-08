I want to try out test dino with my ui automation suite. I will give you the way we are executing tests now and monitoring it in a detailed manner as much as possible and I can tell you what it is that I am expecting from test dino as a reporting tool. You and me, we gotta create a POC which will help us establish a basic POC with test dino as our reporter for this framework. IF we actually can derive value from it, we can go ahead and begin using it

Current State - 
Currently, as you will verify, we are running tests using the playwright.yml file in our .github folder (you can find it in the root folder of this repo). We have a folder wise structure where we are noting down the list of spec file swe wanna execute on our github actions cicd flow. There, we monitor the flow using github actions UI. I will attach a few screenshots in a folder inside the current folder only for you to peruse. Compare it with the yml files to understand it better
This run is triggered everytime we want to merge a PR to main, everytime we commit anything on the PR, every time we manually trigger it and everytime a PR is merged to main branch. 
The reports we have right now are very basic playwright default reporting only - we are not actually visualising the reports anywhere.

What I need-
So mainly, what I need is for a tool to give me a better, more beautiful report of my executions, a proper link with my github actions and every run that is triggered in github actions for my automation suite of ui integration step, I want it to be viewable from test dino. I need a history of runs to know how the runs are fairing, how many runs I am actually having everyday, how many tests are flaky, how many are stable, general checks, stuff like that. 
Moreover, I need to be able to get an email of the report everytime a run happens as well. this should either contain a link to test dino report or the report itself directly however test dino works. You have to study test dino fully to do that.
Link - https://testdino.com/

Approach-
The way to do it would be first to study the way how test dino will work with our codebase, then to ask me as many questions as needed to get more insights on what we are building, then establish a basic POC and take me through step by step with the implementation carefully. We just gotta pick any one test folder for POC then we can do it for the entire thing if needed. This is of course, just my suggestion - feel free to do what you think is best post my permission when you ask. Create a proper PRD first with all details to do this thing and let us review that to begin with.

Critical Rules - 
1) NEVER change any locators of existing tests, any flows and validation logic, any architecture already present. We are trying to be as transparent as possible with this integration
2) Always ask when in doubt - never assume and do anything
3) Sicne you keep compacting conversations and my sessions might also get lost, you gotta keep backing up the current progress and state of completion every once a while - lets say once in 30 minutes or something like that - you can also do it on my prompt - I will tell you to do so. This you can save in this very folder under another folder called Checkpoints. I wanna be able to use these md files to equip any new ai session with claude to understand the whole thing