#run this on a single cluster 

#run this on multiple clusters

url1 = "https://usertest.dev.zinclabs.dev"
user_email1 = ""
user_password1 = ""

url2 = "https://usertest2.dev.zinclabs.dev"
user_email2 = ""
user_password2 = ""

create_objects(url1, user_email1, user_password1, 10)

verify_objects(url2, user_email1, user_password1, 10)

edit_objects(url2, user_email1, user_password1, 10)

verify_objects(url1, user_email1, user_password1, 10)

delete_objects(url2, user_email1, user_password1, 10)

verify_objects(url1, user_email1, user_password1, 10)