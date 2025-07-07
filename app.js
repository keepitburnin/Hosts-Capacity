import axios from 'axios';
import https from 'https';
import { transliterate } from 'transliteration';

// Переменные окружения

import fs from 'fs';
import path from 'path';
import { program } from 'commander';
import { dirname } from 'path';
import { fileURLToPath } from 'url';


const __dirname = dirname(fileURLToPath(import.meta.url));
const CONFIG_FILE_PATH = path.join(__dirname, './env.json');
program.option('-c, --config-file <string>', 'configuration file', CONFIG_FILE_PATH);
program.parse();

const env = JSON.parse(fs.readFileSync(program.opts().configFile))


// Конфигурация

const config = {
  zabbixUrl: `${env.zabbix_url}`,
  auth: {
    username: `${env.user}`,
    password: `${env.password}`
  },
  hostSettings: {
    agentIp: '127.0.0.1',
    agentPort: '10050',
    templates: ['id'],
    hostNamePattern: 'Capacity.{GROUPNAME}',
    groupMacro: '{$GROUP.NAME}',
    preserveCyrillic: true // Сохранять кириллицу в именах (false для транслитерации)
  },
  groupFilter: {
    regexp: 'Netbox.*',
    caseSensitive: false
  }
};

const httpsAgent = new https.Agent({ rejectUnauthorized: false });

class ZabbixHostManager {
  constructor() {
    this.authToken = null;
    
    // Привязываем контекст для методов
    this.authenticate = this.authenticate.bind(this);
    this.createHostsFromGroups = this.createHostsFromGroups.bind(this);
    this.getAllGroups = this.getAllGroups.bind(this);
    this.filterGroupsByRegex = this.filterGroupsByRegex.bind(this);
    this.createHostForGroup = this.createHostForGroup.bind(this);
    this.generateHostName = this.generateHostName.bind(this);
    this.apiRequest = this.apiRequest.bind(this);
  }
 
  sanitizeName(name) {
    if (config.hostSettings.preserveCyrillic) {
      // Просто очищаем от недопустимых символов, сохраняя кириллицу
      return name.replace(/[^a-zA-Zа-яА-ЯёЁ0-9_\-]/g, '_');
    } else {
      // Транслитерируем кириллицу в латиницу
      return transliterate(name).replace(/[^a-zA-Z0-9_\-]/g, '_');
    }
  }

  async authenticate() {
    try {
      const response = await this.apiRequest('user.login', {
        user: config.auth.username,
        password: config.auth.password
      });
      return response.result;
    } catch (error) {
      console.error('Ошибка аутентификации:', error.message);
      throw error;
    }
  }

  async createHostsFromGroups() {
    try {
      this.authToken = await this.authenticate();
      console.log('✓ Аутентификация успешна');

      const allGroups = await this.getAllGroups();
      const filteredGroups = this.filterGroupsByRegex(allGroups);
      console.log(`✓ Найдено подходящих групп: ${filteredGroups.length}`);

      for (const group of filteredGroups) {
        await this.createHostForGroup(group);
      }

      console.log('✓ Все хосты успешно созданы');
    } catch (error) {
      console.error('✗ Ошибка:', error.message);
      throw error;
    }
  }

  async getAllGroups() {
    const response = await this.apiRequest('hostgroup.get', {
      output: ['groupid', 'name'],
      filter: { internal: 0 }
    }, this.authToken);
    return response.result;
  }

  filterGroupsByRegex(groups) {
    const flags = config.groupFilter.caseSensitive ? '' : 'i';
    const regex = new RegExp(config.groupFilter.regexp, flags);
    return groups.filter(group => regex.test(group.name));
  }

  async createHostForGroup(group) {
    try {
      const hostName = this.generateHostName(group.name);
      console.log(`\nСоздаем хост ${hostName} для группы ${group.name}`);

      const hostConfig = {
        host: hostName,
        name: hostName,
        interfaces: [{
          type: 1,
          main: 1,
          useip: 1,
          ip: config.hostSettings.agentIp,
          dns: '',
          port: config.hostSettings.agentPort
        }],
        groups:  [
            {
                "groupid": "id"
            }
        ],
        templates: config.hostSettings.templates.map(id => ({ templateid: id })),
         macros: [
          {
            macro: config.hostSettings.groupMacro,
            value: group.name
          }
        ]
      };

      await this.apiRequest('host.create', hostConfig, this.authToken);
      console.log(`✓ Хост создан с IP ${config.hostSettings.agentIp}`);
    } catch (error) {
      console.error(`✗ Ошибка при создании хоста: ${error.message}`);
    }
  }

  generateHostName(groupName) {
    const cleanGroupName = groupName.replace(/[^a-zA-Z0-9]/g, '.');
    return config.hostSettings.hostNamePattern
      .replace('{GROUPNAME}', cleanGroupName);
  }

  async apiRequest(method, params = {}, authToken = null) {
    const requestData = {
      jsonrpc: '2.0',
      method: method,
      params: params,
      id: Math.floor(Math.random() * 1000)
    };

    if (authToken) {
      requestData.auth = authToken;
    }

    try {
      const response = await axios.post(config.zabbixUrl, requestData, {
        httpsAgent: httpsAgent,
        headers: { 'Content-Type': 'application/json-rpc' },
        timeout: 10000
      });

      if (response.data.error) {
        throw new Error(`API Error: ${JSON.stringify(response.data.error)}`);
      }

      return response.data;
    } catch (error) {
      console.error('Ошибка API запроса:', error.message);
      throw error;
    }
  }
}

// Запуск скрипта
(async () => {
  try {
    const manager = new ZabbixHostManager();
    await manager.createHostsFromGroups();
  } catch (error) {
    console.error('Fatal error:', error);
    process.exit(1);
  }
})();