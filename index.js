/**定义模块和变量**/
const execSync = require('child_process').execSync; //同步子进程
const fs = require('fs'); //文件读取模块
const path = require("path");
const async = require("async");
const request = require('request');
const GitTools = require("./gitTools.js")


const PARENT_DIR = __dirname
const GIT_HOST = "https://gitlab.xxx.com"
      GIT_URL = `${GIT_HOST}/api/v4`
      GIT_TOKEN = "xxxxxx"
const GIT_HOST_NEW = "http://gitlab.yyy.com"
      GIT_URL_NEW = `${GIT_HOST_NEW}/api/v4`
      GIT_TOKEN_NEW = "yyyyyy"

let groups = []
    groupsMap = {}
    groups_new = []
    groups_paths =[]

let groups_count = 0,
    groups_current = 0,
    projects_count = 0,
    projects_current = 0

let git = new GitTools(__dirname)

// checkProjects()
startCopy()

// 比对两边的项目是否已经一一对应
function checkProjects(projectsPath, projectsPathNew) {
    for (let path of projectsPath) {
        // console.log(path.replace(GIT_HOST, GIT_HOST_NEW), projectsPathNew.indexOf(path.replace(GIT_HOST, GIT_HOST_NEW)))
        if (projectsPathNew.indexOf(path.replace(GIT_HOST, GIT_HOST_NEW)) === -1) {
            console.log(path + "<<<<<<<<<<<<<<<<<<<<<")
        }
    }
}

async function startCopy() {
    await initGroupsData()

    for (let group of groups) {
        ++groups_current
        // if (!(groups_current >= 0 && groups_current <= 0))
        //     continue

        try {
            // console.log(`Begin copy group[${group['full_path']} | ${groups_current}/${groups_count}]`)
            // 遍历查看新gitlab分组和本地目录是否存在，不存在就创建
            await checkGroup(group)
    
            await copyProjects(group)

            // console.log(`Finish copy group[${group['full_path']} | ${groups_current}/${groups_count}]`)
        } catch(e) {
            console.error(`Error when copy group[${group['full_path']} | ${groups_current}/${groups_count}] `, e.toString())
        }
    }
}

async function initGroupsData() {
    // 旧地址分组
    groups = await queryGroups(false)
    groupsMap = getGroupsMap(groups)
    
    // 新地址分组
    groups_new = await queryGroups(true)
    groups_paths_new = getGroupsPaths(groups_new)
    
    // 只需前三个，测试时用
    // groups.splice(3)

    console.log(`Old groups[${groups.length}], new groups[${groups_new.length}]`)
}

async function copyProjects(group) {
    let groupFullPath = group['full_path']
    if (groupFullPath.indexOf("onlyoffice-bdr") < 0)
        return

    // 获取当前group下的所有仓库
    let projects = await queryProjectsByGid(group['id'], false)
    let projects_paths = getProjectsPaths(projects, true)
    projects_count = projects.length
    projects_current = 0
    let projects_new = await queryProjectsByGid(getGroupId(groupFullPath), true)
    let projects_paths_new = getProjectsPaths(projects_new, true)
    // checkProjects(projects_paths, projects_paths_new)
    // if (projects_count !== projects_new.length)
        console.log(`>>> Old projects length[${projects.length}], new projects length[${projects_new.length}]`)
    
    for (let project of projects) {
        ++projects_current

        try{
            console.log(`Begin copy group[${groups_current}/${groups_count}]>project[${projects_current}/${projects_count}]`)
            let projectUrl = project['http_url_to_repo']
            let groupDir = PARENT_DIR+"/"+groupFullPath
            let projectDir = groupDir+"/"+project["path"]
            let newProjectUrl = projectUrl.replace(GIT_HOST, GIT_HOST_NEW)
            // 还不知道 git clone --mirror 后怎么更新，就直接简单粗暴地来：删了本地目录重新 clone
            if (fs.existsSync(projectDir)) {
                console.log(`Dir exists, remove it > ${projectDir}【${projectUrl}】`)
                removeDir(projectDir)
            }
            await cloneProject(projectUrl, project["path"], groupDir)
            
            // 如果新gitlab上没有项目，在新 gitlab 创建新的项目
            if (projects_paths_new.indexOf(newProjectUrl) === -1) {
                let newProject = await createProject(project)
                // console.log(newProject)
                if(newProject['http_url_to_repo'])
                    projects_paths_new.push(newProject['http_url_to_repo'])
            }
            
            // 提交代码到新的 gitlab 项目中
            await pushProject(projectDir, newProjectUrl)
            console.log(`Finish copy group[${groups_current}/${groups_count}]>project[${projects_current}/${projects_count}]`)
            console.log()
        } catch(e) {
            console.error(`Error when copy group[${groups_current}/${groups_count}]>project[${projects_current}/${projects_count}] `, e.toString())
        }
    }
}


async function queryGroups(isNewGitLab=false) {
    let url = (isNewGitLab ? GIT_URL_NEW : GIT_URL) + "/groups?per_page=100&order_by=path&sort=asc&private_token=" + (isNewGitLab ? GIT_TOKEN_NEW : GIT_TOKEN)
    // console.log(`Query groups [${url}]`)
    return new Promise(function(resolve, reject){
        request.get({url}, function(error, res, body) {
            resolve(JSON.parse(body))
        })
    })
}

async function createGroup(group) {
    let groupPath = group['full_path']
    // 新 gitlab 中已有分组
    if (groups_paths_new.indexOf(groupPath) >= 0)
        return true

    if (group['parent_id']) {
        let parentGroupPath = groupPath.substring(0, groupPath.lastIndexOf("/"))
        // 如果新 gitlab 中没有上级分组，就创建上级分组
        if (groups_paths_new.indexOf(parentGroupPath) === -1) {
            // console.log(parentGroupPath, groupsMap)
            await createGroup(groupsMap[parentGroupPath])
        }
        group['parent_id'] = getGroupId(parentGroupPath)
    }

    return new Promise(function(resolve, reject){
        request({
            url: GIT_URL_NEW + "/groups",
            method: "POST",
            json: true,
            headers: {
                "PRIVATE-TOKEN": GIT_TOKEN_NEW,
                "content-type": "application/json",
                'User-Agent': 'Mozilla/5.0 (Windows NT 6.1; Trident/7.0; rv:11.0) like Gecko',
            },
            body: group
        }, function(error, response, body) {
            let new_group = body
            // console.log(new_group, typeof(new_group))
            // 创建成功的分组加入到 new_groups
            groups_new.push(new_group)
            // 更新 new_groups_paths
            groups_paths_new = getGroupsPaths(groups_new)
            resolve(new_group)
        })
    })
}

function getGroupId(groupPath) {
    for (let gp of groups_new) {
        if (groupPath === gp['full_path'])
            return gp['id']
    }
    return null
}

function getGroupsPaths(groups) {
    let paths = []
    for (let group of groups) {
        paths.push(group['full_path'])
    } 
    return paths
}

function getGroupsMap(groups) {
    let map = {}
    for (let group of groups) {
        map[group['full_path']] = group
    } 
    return map
}

function getProjectsPaths(projects, returnGitHost=true) {
    let paths = []
    for (let project of projects) {
        let path = project['http_url_to_repo']
        if (!returnGitHost) {
            let reg = /(http|https):\/\/([^\/]+)\//i
            let domain = path.match(reg)
            // console.log(domain)
            //替换
            path = path.replace(domain[0], "");
        }
        paths.push(path)
    } 
    return paths
}

// 检查分组，没有就创建
async function checkGroup(group) {
    let dirPath = PARENT_DIR + '/' + group['full_path']
    mkdirsSync(dirPath)

    await createGroup(group)
}

// 递归创建目录 同步方法
function mkdirsSync(dirname) {
    if (fs.existsSync(dirname)) {
      return true;
    } else {
      if (mkdirsSync(path.dirname(dirname))) {
        fs.mkdirSync(dirname);
        return true;
      }
    }
}

function removeDir(p){
    let statObj = fs.statSync(p); // fs.statSync同步读取文件状态，判断是文件目录还是文件。
    if(statObj.isDirectory()){ //如果是目录
        let dirs = fs.readdirSync(p) //fs.readdirSync()同步的读取目标下的文件 返回一个不包括 '.' 和 '..' 的文件名的数组['b','a']
        dirs = dirs.map(dir => path.join(p, dir))  //拼上完整的路径
        for (let i = 0; i < dirs.length; i++) {
            // 深度 先将儿子移除掉 再删除掉自己
            removeDir(dirs[i]);
        }
        fs.rmdirSync(p); //删除目录
    }else{
        fs.unlinkSync(p); //删除文件
    }
}


async function queryProjects(isNewGitLab=false) {
    let url = (isNewGitLab ? GIT_URL_NEW : GIT_URL) + "/projects?per_page=100&order_by=path&private_token=" + (isNewGitLab ? GIT_TOKEN_NEW : GIT_TOKEN)
    // console.log(`Query projects [${url}]`)
    return new Promise(function(resolve, reject){
        request.get({ url }, function(error, res, body) {
            resolve(JSON.parse(body))
        })
    })
}

async function queryProjectsByGid(groupId, isNewGitLab=false) {
    // console.log(`Query projects by group id(${groupId})`)
    return new Promise(function(resolve, reject){
        request.get({url: (isNewGitLab ? GIT_URL_NEW : GIT_URL) + "/groups/" + groupId + "/projects?per_page=100&private_token=" + (isNewGitLab ? GIT_TOKEN_NEW : GIT_TOKEN) }, function(error, res, body) {
            resolve(JSON.parse(body))
        })
    })
}

async function queryProjectsByid(projectId) {
    console.log(`Query projects by project id(${projectId})`)
    return new Promise(function(resolve, reject){
        request.get({url: GIT_URL + "/projects/" + projectId + "/projects?per_page=100&private_token=" + GIT_HOST_NEW }, function(error, res, body) {
            resolve(JSON.parse(body))
        })
    })
}

// 新建项目
async function createProject(project) {
    project['namespace_id'] = getGroupId(project['namespace']['full_path'])
    return new Promise(function(resolve, reject){
        request({
            url: GIT_URL_NEW + "/projects",
            method: "POST",
            json: true,
            headers: {
                "PRIVATE-TOKEN": GIT_TOKEN_NEW,
                "content-type": "application/json",
                'User-Agent': 'Mozilla/5.0 (Windows NT 6.1; Trident/7.0; rv:11.0) like Gecko',
            },
            body: project
        }, function(error, response, body) {
            resolve(body)
        })
    })
}

// 拉取代码
async function cloneProject(projectUrl, projectPath, groupDir){
    console.log(`Clone [${projectUrl}] to [${groupDir}][${projectPath}]`)
    
    git.resetCwd(groupDir.split('/').join("\\"))
    let data =  await git['clone'](projectUrl, projectPath);
    return (data)
}

// 提交代码
async function pullProject(projectDir, path){
    console.log(`Pull ${path}[${projectDir}]`)
    git.resetCwd(projectDir)
    await git.resetUrl(path)
    await git.pullAll()
}

// 提交代码
async function pushProject(projectDir, path){
    console.log(`Push ${path}[${projectDir}]`)
    git.resetCwd(projectDir)
    await git.resetUrl(path)
    await git.push()
}
