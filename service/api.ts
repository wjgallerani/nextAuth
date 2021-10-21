import axios, { AxiosError } from 'axios';
import { parseCookies, setCookie } from 'nookies';
import { signOut } from '../contexts/AuthContext';
import { AuthTokenError } from '../errors/AuthTokenError';

let isRefreshing = false;
let failedRequestQueue = [];

type User = {
    token?: string;
    refreshToken?: string;
    code: string
}

export function setupApiClient(ctx = undefined) {

    let cookies = parseCookies(ctx);

    const api = axios.create({
        baseURL: 'http://localhost:3333',
        headers: {
            Authorization: `Bearer ${cookies['nextauth.token']}`
        }
    });

    api.interceptors.response.use(response => {
        return response;
    }, (error: AxiosError<User>) => {

        if (error.response.status === 401) {
            if (error.response.data?.code === 'token.expired') {
                cookies = parseCookies(ctx);

                const { 'nextauth.refreshToken': refreshToken } = cookies;
                const originalConfig = error.config;

                if (!isRefreshing) {
                    isRefreshing = true;

                    api.post<User>('/refresh', {
                        refreshToken
                    }).then(response => {
                        const { token } = response.data;

                        setCookie(ctx, 'nextauth.token', token, {
                            maxAge: 60 * 60 * 24 * 30, // 1 mes
                            path: '/'
                        });

                        setCookie(ctx, 'nextauth.refreshToken', response.data.refreshToken, {
                            maxAge: 60 * 60 * 24 * 30, // 1 mes
                            path: '/'
                        });

                        api.defaults.headers['Authorization'] = `Bearer ${token}`;

                        failedRequestQueue.forEach(request => request.onSuccess(token))
                        failedRequestQueue = [];
                    }).catch(err => {
                        failedRequestQueue.forEach(request => request.onFailure(err))
                        failedRequestQueue = [];

                        if (process.browser) {
                            signOut();
                        }
                    }).finally(() => {
                        isRefreshing = false;
                    });
                }

                return new Promise((resolve, reject) => {
                    failedRequestQueue.push({
                        onSuccess: (token: string) => {
                            originalConfig.headers['Authorization'] = `Bearer ${token}`;

                            resolve(api(originalConfig));
                        },
                        onFailure: (err: AxiosError) => {
                            reject(err);
                        }
                    });
                });
            } else {
                if (process.browser) {
                    signOut();
                } else {
                    return Promise.reject(new AuthTokenError());
                }
            }
        }

        return Promise.reject(error);
    });

    return api;
}