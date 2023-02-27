# 4.测试用例
可以参考 tunnel-external（dmz隧道/dmz-pipy）、tunnel-internal（app隧道/app-pipy) 的 config.json 配置。  
## 4.1  IPV6/IPV4双栈支持
### 4.1.1 支持IPV6访问
**对外暴露ipv6的地址，内部流量是ipv4.**   
在 loadBalancers 里面可以配置 ipv6 地址（如下）：  
```bash
"[fe80::1913:e751:9d51:d1fa%enp1s0]:8000": {
  "mode": "lc",
  "sticky": false,
  "targets": {
    "127.0.0.1:22": 100
  },
  "bpsLimit": -1,
  "maxConnections": -1,
  "idleTimeout": "300s",
  "serviceId": "svc-3"
}
```

### 4.1.2 支持IPV4访问（默认）
**对外暴露ipv4的地址，内部流量是ipv4。**  
在 loadBalancers 里面可以配置 ipv4 地址（如下）：
```bash
"127.0.0.1:6000": {
  "mode": "rr",
  "sticky": false,
  "targets": {
    "127.0.0.1:8001": 100,
    "127.0.0.1:8002": 100,
    "127.0.0.1:8003": 100
  },
  "bpsLimit": -1,
  "maxConnections": -1,
  "idleTimeout": "300s",
  "serviceId": "svc-1"
},
```
### 4.1.3 配置补充说明
**1、可以配置监听某个ip地址，参考：**   
  ipv4： "127.0.0.1:6000"  
  ipv6："[fe80::1913:e751:9d51:d1fa%enp1s0]:8000"  
**2、可以配置监听所有的 ipv4地址，参考：**  
  “0.0.0.0:7000”  
**3、可以配置监听所有的ipv4和ipv6地址，参考：**  
  “：：：7000”  

## 4.2  协议支持
### 4.2.1 支持TCP 4层协议代理功能  
验证内容	验证隧道对于TCP4层协议的代理功能，通过隧道访问后端TCP服务  
验证步骤	  
1. dmz-pipy 配置
```bash
{
  "loadBalancers": {
    "127.0.0.1:7000": {
      "mode": "rr",
      "sticky": false,
      "targets": {
        "127.0.0.1:22": 100
      },
      "bpsLimit": -1,
      "maxConnections": -1,
      "idleTimeout": "300s",
      "serviceId": "svc-1"
    }
  },
  "tunnel": {
    "servers": {
      "127.0.0.1:801": {
        "name": "tunnel-1",
        "weight": 100,
        "tlsCert": "tls/server1.crt",
        "tlsKey": "tls/server1.key",
        "tlsCA": "tls/server1.ca"
      }
    },
    "policies": {
      "connectRetry": 1
    },
    "healthcheck": {
      "server": {
        "failures": 2,
        "interval": "3s"
      },
      "target": {
        "failures": 1,
        "interval": "15s"
      },
      "connectTimeout": "1s",
      "readTimeout": "3s"
    }
  },
  "healthcheck": {
    "host": "localhost",
    "port": 8888,
    "interval": "3s"
  },
  "global": {
    "enableDebug": false
  }
}
```
2. app-pipy 配置  
```bash
{
  "servers": {
    "127.0.0.1:801": {
      "maxConnections": -1,
      "idleTimeout": "300s",
      "tlsCert": "tls/server1.crt",
      "tlsKey": "tls/server1.key",
      "tlsCA": "tls/server1.ca"
    }
  },
  "policies": {
    "connectRetry": 1
  },
  "global": {
    "enableDebug": false
  }
}
```
验证结果  
可以访问 ssh 127.0.0.1 -p 7000  

备注  	

### 4.2.2  支持HTTP/HTTPS 7层协议代理功能  
验证内容	验证隧道对于HTTP/HTTPS协议代理功能，通过隧道访问后端HTTP服务    
验证步骤  
步骤同上，只需要将后端应用从 ssh 服务改成其他 http/https 服务。   
验证结果   	
备注  	 

### 4.2.3  支持MQ协议代理功能  
验证内容	验证隧道对于MQ协议代理功能，通过隧道访问后端MQ服务    
验证步骤	  
步骤同上，只需要将后端应用从 ssh 服务改成 mq 服务。    
验证结果	  
备注	使用RocketMQ作为验证MQ协议的服务端   
RocketMQ   

### 4.2.4  支持HTTP/HTTPS静态资源服务  
验证内容	使用Pipy作为Web静态服务器   
验证步骤	 
步骤同上。   
验证结果	 
备注	 

## 4.3  出栈流量管理——Egress  
 流量路径：全栈云--->DMZ--->外部网络   
### 4.3.1  全栈云访问DMZ    
验证内容	验证全栈云内服务通过HTTP隧道访问DMZ区服务   
验证步骤	 
验证结果	 
备注	 

### 4.3.2  DMZ访问外部网络（暂时不做）  
<添加描述>   
### 4.3.3  全栈云访问外部网络（暂时不做）  
<添加描述>   

## 4.4  健康检查  
### 4.4.1  显示隧道健康检查状态  
验证内容	验证每个隧道的健康检查状态显示    
验证步骤   
访问 metrics： curl -v http://localhost:3000/metrics | grep "health"   	  
验证结果 结果为1:表示健康正常，结果为0:表示健康异常    
pipy_tunnel_healthy{tunnelName="tunnel-1"} 1 
备注  	 

### 4.4.2  隧道节点链路切换  
验证内容	验证当APP区隧道节点出现故障时的流量线路切换。  
验证步骤	  
1. dmz-pipy 配置  
```bash  
{
  "loadBalancers": {
    "127.0.0.1:7000": {
      "mode": "rr",
      "sticky": false,
      "targets": {
        "127.0.0.1:22": 100
      },
      "bpsLimit": -1,
      "maxConnections": -1,
      "idleTimeout": "300s",
      "serviceId": "svc-1"
    }
  },
  "tunnel": {
    "servers": {
      "127.0.0.1:801": {
        "name": "tunnel-1",
        "weight": 100,
        "tlsCert": "tls/server1.crt",
        "tlsKey": "tls/server1.key",
        "tlsCA": "tls/server1.ca"
      },
      "127.0.0.1:8001": {
        "name": "tunnel-2",
        "weight": 100
      }
    },
    "policies": {
      "connectRetry": 1
    },
    "healthcheck": {
      "server": {
        "failures": 2,
        "interval": "3s"
      },
      "target": {
        "failures": 1,
        "interval": "15s"
      },
      "connectTimeout": "1s",
      "readTimeout": "3s"
    }
  },
  "healthcheck": {
    "host": "localhost",
    "port": 8888,
    "interval": "3s"
  },
  "global": {
    "enableDebug": false
  }
}

```
2. app-pipy 配置
```bash
{
  "servers": {
    "127.0.0.1:801": {
      "maxConnections": -1,
      "idleTimeout": "300s",
      "tlsCert": "tls/server1.crt",
      "tlsKey": "tls/server1.key",
      "tlsCA": "tls/server1.ca"
    },
    "127.0.0.1:8001": {
      "maxConnections": -1,
      "idleTimeout": "300s"
    }
  },
  "policies": {
    "connectRetry": 1
  },
  "global": {
    "enableDebug": false
  }
}

```
验证结果	 
正常情况下，会将流量负载均衡到 tunnel-1 和 tunnel-2    
如果如果其中一个 tunnel 出现故障，会通过健康检查，避免将流量转发到故障隧道。    

备注	 
### 4.4.3  上游服务流量线路切换  
验证内容	验证当后端服务出现故障时的流量线路切换。    
验证步骤	
1. dmz-pipy 配置  
```bash
{
  "loadBalancers": {
    "127.0.0.1:7000": {
      "mode": "rr",
      "sticky": false,
      "targets": {
        "127.0.0.1:22": 100,
        "127.0.0.2:22": 100,
        "127.0.0.3:22": 100
      },
      "bpsLimit": -1,
      "maxConnections": -1,
      "idleTimeout": "300s",
      "serviceId": "svc-1"
    }
  },
  "tunnel": {
    "servers": {
      "127.0.0.1:801": {
        "name": "tunnel-1",
        "weight": 100,
        "tlsCert": "tls/server1.crt",
        "tlsKey": "tls/server1.key",
        "tlsCA": "tls/server1.ca"
      },
      "127.0.0.1:8001": {
        "name": "tunnel-2",
        "weight": 100
      }
    },
    "policies": {
      "connectRetry": 1
    },
    "healthcheck": {
      "server": {
        "failures": 2,
        "interval": "3s"
      },
      "target": {
        "failures": 1,
        "interval": "15s"
      },
      "connectTimeout": "1s",
      "readTimeout": "3s"
    }
  },
  "healthcheck": {
    "host": "localhost",
    "port": 8888,
    "interval": "3s"
  },
  "global": {
    "enableDebug": false
  }
}

```
2. app-pipy 配置  
```bash
{
  "servers": {
    "127.0.0.1:801": {
      "maxConnections": -1,
      "idleTimeout": "300s",
      "tlsCert": "tls/server1.crt",
      "tlsKey": "tls/server1.key",
      "tlsCA": "tls/server1.ca"
    },
    "127.0.0.1:8001": {
      "maxConnections": -1,
      "idleTimeout": "300s"
    }
  },
  "policies": {
    "connectRetry": 1
  },
  "global": {
    "enableDebug": false
  }
}

```
验证结果   
正常情况下，会将流量负载均衡到后端的 targets 服务，      
如果如果其中一个 服务 出现故障，会通过健康检查，避免将流量转发到故障target/服务。    

备注	可以切换到另外的az、切换到逃生线路等。   

## 4.5  流量统计  
验证内容	统计原始网络流量与隧道流量的速率  
验证步骤	  
访问 metrics： curl -v http://localhost:3000/metrics | grep "bytes" | grep "target=" | sort    

验证结果	 
pipy_receive_target_bytes_total{serviceId="svc-1",tunnelName="tunnel-1",target="127.0.0.1:22"} 105090745  
pipy_receive_tunnel_bytes_total{serviceId="svc-1",tunnelName="tunnel-1",target="127.0.0.1:22"} 105398614  
pipy_send_target_bytes_total{serviceId="svc-1",tunnelName="tunnel-1",target="127.0.0.1:22"} 35853  
pipy_send_tunnel_bytes_total{serviceId="svc-1",tunnelName="tunnel-1",target="127.0.0.1:22"} 144378  

备注    
1. 其中 target_bytes 是原始网络流量    
2. 其中 tunnel_bytes 是隧道网络流量  

## 4.6  流量限速  
验证内容	验证基于原始网络流量（bps）的流量限速  
验证步骤	  
在 dmz-pipy 配置里面配置限速，比如：3MB/s    
"bpsLimit": 3000000,  
验证结果	 
流量会限制在大约：3MB/s  
备注	

## 4.7  非功能测试  
### 4.7.1  链路时延消耗  
验证内容	验证经过隧道后的延迟增加  
验证步骤	  
下载大文件，对比网速测试。（略）    
验证结果	  

备注	需要额外网络策略，即从DMZ区测试节点到全栈云内的服务打通防火墙策略  

### 4.7.2  代理节点资源消耗  
验证内容	验证在特定请求速率情况下隧道代理节点的资源消耗情况  
验证步骤	  
查看 dmz-pipy, app-pipy 资源使用情况。（略）   
验证结果	  
备注	CPU、Memory、带宽的消耗  
  
### 4.7.3  数据面扩容  
验证内容	验证数据面（隧道代理节点）扩容后，代理能力是否可以线性增长  
验证步骤	 
需要使用多台机器进行验证。 
验证结果	 
备注	 

### 4.7.4 管理面容灾  
验证内容	验证管理面节点发生故障时是否影响当前  
验证步骤	  
dmz-pipy, app-pipy 启动成功后，不受管理面节点发生故障的影响。  
验证结果	  
备注	需描述管理面失效的影响与数据持久化过程。 
  
