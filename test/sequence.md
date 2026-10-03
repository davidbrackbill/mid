autonumber

| actor: User  | Client         | Server         | Database |
| ------------ | -------------- | -------------- | -------- |
| Click log in | ->>            |                |          |
|              | POST /login    | ->>+           |          |
|              |                | Find user      | -->>     |
|              |                | -->>           | Row      |
|              |                | Check password |          |
|              | -->>-          | Session token  |          |
|              | Track login    | -)             |          |
| -x           | Show dashboard |                |          |
